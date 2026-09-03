import { NextResponse } from 'next/server';
import { appendDomainEventWithOutbox } from '@expadio/postgres-runtime/domain-events';
import { persistGovernedActionIntent } from '@expadio/postgres-runtime/governed-action-intent';
import {
  deniedResponse,
  requireStepUp,
  resolveRequestContext,
  withTenantClient,
  withTenantTransaction,
} from '../../../../../../lib/request-context';
import { hasPlatformAdministrationRole } from '../../../../../../lib/governance-authz';
import {
  executeGovernedCommunicateActionInTransaction,
} from '../../../../../../lib/governed-communicate-executor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CertificationChannel = 'email' | 'sms' | 'whatsapp' | 'voice';

interface CertificationSendBody {
  readonly requestId?: unknown;
  readonly recipient?: unknown;
  readonly voiceUrl?: unknown;
}

interface ExistingRequestRow {
  readonly certification_request_id: string;
  readonly delivery_id: string;
  readonly connector_key: string;
  readonly provider_key: string;
  readonly channel: CertificationChannel;
  readonly status: 'CERTIFYING' | 'LIVE_CERTIFIED' | 'FAILED' | 'REVOKED';
}

interface ConnectorRow {
  readonly provider_key: string;
  readonly provider_type: string;
  readonly enabled: boolean;
}

interface ProviderSpec {
  readonly providerKey: 'resend' | 'twilio-sms' | 'twilio-whatsapp' | 'twilio-voice';
  readonly channel: CertificationChannel;
  readonly capabilityKey: string;
}

const PROVIDER_SPECS: Readonly<Record<string, ProviderSpec>> = {
  resend: {
    providerKey: 'resend',
    channel: 'email',
    capabilityKey: 'communication.email.send',
  },
  'twilio-sms': {
    providerKey: 'twilio-sms',
    channel: 'sms',
    capabilityKey: 'communication.sms.send',
  },
  'twilio-whatsapp': {
    providerKey: 'twilio-whatsapp',
    channel: 'whatsapp',
    capabilityKey: 'communication.whatsapp.send',
  },
  'twilio-voice': {
    providerKey: 'twilio-voice',
    channel: 'voice',
    capabilityKey: 'communication.voice.dial',
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    await requireStepUp();

    const authorized = await withTenantTransaction(
      context,
      (client) => hasPlatformAdministrationRole(client, context.subjectId),
    );
    if (!authorized) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'PLATFORM_ADMIN_REQUIRED',
          message: 'Only Platform Administration can certify communication connectors.',
        },
        { status: 403 },
      );
    }

    const connectorKey = decodeURIComponent((await params).key).trim();
    const body = (await request.json()) as CertificationSendBody;
    const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
    const recipientInput = typeof body.recipient === 'string' ? body.recipient.trim() : '';
    const voiceUrl = typeof body.voiceUrl === 'string' ? body.voiceUrl.trim() : '';
    if (!UUID.test(requestId)) {
      return NextResponse.json(
        { error: 'requestId must be a stable UUID for idempotent certification.' },
        { status: 400 },
      );
    }

    const commitSha = (
      process.env.RAILWAY_GIT_COMMIT_SHA
      ?? process.env.VERCEL_GIT_COMMIT_SHA
      ?? process.env.GITHUB_SHA
      ?? ''
    ).trim().toLowerCase();
    if (!COMMIT_SHA.test(commitSha)) {
      return NextResponse.json(
        {
          error: 'Deployment commit evidence is unavailable; certification cannot start.',
          reasonKey: 'CERTIFICATION_COMMIT_EVIDENCE_REQUIRED',
        },
        { status: 503 },
      );
    }

    const outcome = await withTenantClient(context, async (client) => {
      await client.query('BEGIN');
      try {
        const existingResult = await client.query<ExistingRequestRow>(
          `SELECT request.certification_request_id, request.delivery_id,
                  request.connector_key, request.provider_key, request.channel,
                  request.status
             FROM platform.communication_certification_requests request
             JOIN platform.governed_action_intents intent
               ON intent.action_intent_id = request.action_intent_id
            WHERE request.tenant_id = $1::uuid
              AND intent.source_event_id = $2::uuid
            LIMIT 1`,
          [context.tenantId, requestId],
        );
        const existing = existingResult.rows[0];
        if (existing !== undefined) {
          await client.query('COMMIT');
          return {
            status: 200 as const,
            body: {
              certificationRequestId: existing.certification_request_id,
              deliveryId: existing.delivery_id,
              connectorKey: existing.connector_key,
              providerKey: existing.provider_key,
              channel: existing.channel,
              certificationStatus: existing.status,
              replayed: true,
            },
          };
        }

        const connectorResult = await client.query<ConnectorRow>(
          `SELECT provider_key, provider_type, enabled
             FROM platform.connectors
            WHERE connector_key = $2
              AND (tenant_id IS NULL OR tenant_id = $1::uuid)
            LIMIT 1
            FOR SHARE`,
          [context.tenantId, connectorKey],
        );
        const connector = connectorResult.rows[0];
        if (connector === undefined) {
          await client.query('ROLLBACK');
          return { status: 404 as const, body: { error: 'Communication connector was not found.' } };
        }

        const spec = PROVIDER_SPECS[connector.provider_key.trim().toLowerCase()];
        if (
          spec === undefined
          || connector.provider_type !== spec.channel
          || connector.enabled !== true
        ) {
          await client.query('ROLLBACK');
          return {
            status: 409 as const,
            body: {
              error: 'Connector is not enabled on a supported durable Communications runtime.',
              reasonKey: 'CERTIFICATION_CONNECTOR_NOT_READY',
            },
          };
        }

        const recipient = normalizeRecipient(spec.channel, recipientInput);
        if (recipient === null) {
          await client.query('ROLLBACK');
          return {
            status: 400 as const,
            body: {
              error: spec.channel === 'email'
                ? 'A valid certification recipient email is required.'
                : 'A valid E.164 certification recipient phone number is required.',
            },
          };
        }
        if (spec.channel === 'voice' && !isHttpsUrl(voiceUrl)) {
          await client.query('ROLLBACK');
          return {
            status: 400 as const,
            body: { error: 'Voice certification requires an HTTPS TwiML voiceUrl.' },
          };
        }

        const now = new Date();
        const correlationId = `communications-certification:${requestId}`;
        const appended = await appendDomainEventWithOutbox(client, {
          event: {
            eventId: requestId,
            tenantId: context.tenantId,
            aggregateType: 'communication.connector',
            aggregateId: connectorKey,
            eventType: 'communications.connector.certification-requested',
            eventVersion: 1,
            occurredAt: now,
            recordedAt: now,
            actorSubjectId: context.subjectId,
            correlationId,
            causationId: null,
            packKey: null,
            packVersion: null,
            payload: {
              connectorKey,
              providerKey: spec.providerKey,
              channel: spec.channel,
            },
            metadata: {
              source: 'platform.communications.certification-send',
              commitSha,
            },
          },
        });

        const intent = await persistGovernedActionIntent(client, {
          tenantId: context.tenantId,
          sourceEventId: appended.event.eventId,
          sourceEventType: appended.event.eventType,
          aggregateType: appended.event.aggregateType,
          aggregateId: appended.event.aggregateId,
          ruleKey: 'communications.live-certification',
          executorClass: 'COMMUNICATE',
          actionKey: 'communications.certification.send',
          idempotencyKey: correlationId,
          correlationId,
          causationId: appended.event.eventId,
          requestedBySubjectId: context.subjectId,
          requestedAt: now,
          configuration: {
            triggerKey: 'communications.live-certification',
            recipient: spec.channel === 'email'
              ? { email: recipient }
              : { phone: recipient },
            variables: spec.channel === 'voice' ? { voiceUrl } : {},
            purpose: 'system',
            consentRequired: false,
            channel: spec.channel,
            locale: 'en',
            ...(context.organizationId === null
              ? {}
              : { organizationId: context.organizationId }),
            capabilityKey: spec.capabilityKey,
          },
          policyDecision: {
            allowed: true,
            policyKeys: [
              'communications.platform-admin',
              'communications.step-up',
              'communications.live-certification',
            ],
            evidenceRefs: [
              `communication-connector://${connectorKey}`,
              `deployment-commit://${commitSha}`,
            ],
            reasonCode: 'COMMUNICATION_CERTIFICATION_AUTHORIZED',
            evaluatedAt: now,
          },
        });

        const execution = await executeGovernedCommunicateActionInTransaction(client, {
          intent,
          now: () => now.toISOString(),
        });
        if (!execution.queue?.queued) {
          await client.query('ROLLBACK');
          return {
            status: 409 as const,
            body: {
              error: execution.queue?.reason ?? 'Certification delivery was not queued.',
              reasonKey: execution.queue?.reasonCode ?? 'CERTIFICATION_QUEUE_REFUSED',
            },
          };
        }
        if (execution.queue.connector.connectorKey !== connectorKey) {
          await client.query('ROLLBACK');
          return {
            status: 409 as const,
            body: {
              error: 'Routing selected a different connector; certification was not started.',
              reasonKey: 'CERTIFICATION_CONNECTOR_ROUTE_MISMATCH',
            },
          };
        }

        const inserted = await client.query<{ readonly certification_request_id: string }>(
          `INSERT INTO platform.communication_certification_requests (
             tenant_id, organization_id, action_intent_id, delivery_id,
             connector_key, provider_key, channel, adapter_key, capability_key,
             commit_sha, operator_subject_id
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::uuid,
             $5, $6, $7, $8, $9, $10, $11
           )
           RETURNING certification_request_id`,
          [
            context.tenantId,
            context.organizationId,
            intent.actionIntentId,
            execution.queue.delivery.deliveryId,
            connectorKey,
            spec.providerKey,
            spec.channel,
            execution.queue.delivery.adapterKey,
            spec.capabilityKey,
            commitSha,
            context.subjectId,
          ],
        );
        const certificationRequest = inserted.rows[0];
        if (certificationRequest === undefined) {
          throw new Error('COMMUNICATION_CERTIFICATION_REQUEST_INSERT_FAILED');
        }

        await client.query('COMMIT');
        return {
          status: 202 as const,
          body: {
            certificationRequestId: certificationRequest.certification_request_id,
            actionIntentId: intent.actionIntentId,
            deliveryId: execution.queue.delivery.deliveryId,
            connectorKey,
            providerKey: spec.providerKey,
            channel: spec.channel,
            certificationStatus: 'CERTIFYING',
            message: 'Certification delivery queued. LIVE requires a signed terminal provider webhook.',
          },
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });

    return NextResponse.json(outcome.body, {
      status: outcome.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

function normalizeRecipient(channel: CertificationChannel, value: string): string | null {
  if (channel === 'email') {
    const email = value.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : null;
  }
  const phone = value.startsWith('whatsapp:') ? value.slice('whatsapp:'.length) : value;
  return /^\+[1-9]\d{7,14}$/u.test(phone) ? phone : null;
}

function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}
