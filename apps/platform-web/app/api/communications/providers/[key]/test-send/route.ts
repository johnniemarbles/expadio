import { NextResponse } from 'next/server';
import { DecisionTraceBuilder } from '@expadio/communication';
import { governedResendApiTokenProvider } from '@expadio/communication/governed-resend-binding';
import { governedTwilioCredentialsProvider } from '@expadio/communication/governed-twilio-binding';
import { routePreparedCommunicationDispatch } from '@expadio/communication/dispatch-routing';
import { prepareCommunicationProviderSendRequest } from '@expadio/communication/provider-send-request';
import { ResendEmailAdapter } from '@expadio/communication/resend-email-adapter';
import { TwilioSmsWhatsappAdapter } from '@expadio/communication/twilio-sms-whatsapp-adapter';
import { TwilioVoiceAdapter } from '@expadio/communication/twilio-voice-adapter';
import type { CommunicationProviderSendResult } from '@expadio/communication/provider-adapter';
import type { PreparedCommunicationDispatch } from '@expadio/communication/dispatch';
import {
  PostgresCommunicationSenderRepository,
} from '@expadio/postgres-runtime/sender';
import {
  PostgresConnectorCredentialRepository,
  PostgresProviderRegistryRepository,
} from '@expadio/postgres-runtime/provider-registry';
import {
  createGovernedCredentialLeaseRuntime,
} from '@expadio/postgres-runtime/governed-credential-lease-runtime';
import {
  deniedResponse,
  requireStepUp,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../../../../lib/request-context';
import { delegatedSecretResolver } from '../../../../../../lib/vault-secret-resolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TestChannel = 'email' | 'sms' | 'whatsapp' | 'voice';

interface TestSendBody {
  readonly recipient?: unknown;
  readonly idempotencyKey?: unknown;
  readonly voiceUrl?: unknown;
}

interface ConnectorMetadataRow {
  readonly provider_key: string;
  readonly provider_type: string;
}

interface ProviderSpec {
  readonly providerKey: 'resend' | 'twilio-sms' | 'twilio-whatsapp' | 'twilio-voice';
  readonly providerType: TestChannel;
  readonly capabilityKey: string;
}

const PROVIDER_SPECS: Readonly<Record<string, ProviderSpec>> = {
  resend: {
    providerKey: 'resend',
    providerType: 'email',
    capabilityKey: 'communication.email.send',
  },
  'twilio-sms': {
    providerKey: 'twilio-sms',
    providerType: 'sms',
    capabilityKey: 'communication.sms.send',
  },
  'twilio-whatsapp': {
    providerKey: 'twilio-whatsapp',
    providerType: 'whatsapp',
    capabilityKey: 'communication.whatsapp.send',
  },
  'twilio-voice': {
    providerKey: 'twilio-voice',
    providerType: 'voice',
    capabilityKey: 'communication.voice.dial',
  },
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    await requireStepUp();

    const connectorKey = decodeURIComponent((await params).key).trim();
    const body = (await request.json()) as TestSendBody;
    const recipientInput = typeof body.recipient === 'string' ? body.recipient.trim() : '';
    const idempotencyKey = typeof body.idempotencyKey === 'string'
      ? body.idempotencyKey.trim()
      : '';
    const voiceUrl = typeof body.voiceUrl === 'string' ? body.voiceUrl.trim() : '';

    if (
      idempotencyKey.length < 8
      || idempotencyKey.length > 256
      || /[\r\n\t]/u.test(idempotencyKey)
    ) {
      return NextResponse.json(
        { error: 'A stable idempotencyKey (8–256 characters) is required.' },
        { status: 400 },
      );
    }

    const requestedAt = new Date().toISOString();

    const result = await withTenantTransaction(context, async (client) => {
      const metadata = await client.query<ConnectorMetadataRow>(
        `SELECT provider_key, provider_type
           FROM platform.connectors
          WHERE connector_key = $2
            AND (tenant_id IS NULL OR tenant_id = $1::uuid)
          LIMIT 1`,
        [context.tenantId, connectorKey],
      );
      const metadataRow = metadata.rows[0];
      if (metadataRow === undefined) {
        return {
          status: 404 as const,
          body: { error: 'Communication connector was not found.' },
        };
      }

      const spec = PROVIDER_SPECS[metadataRow.provider_key.trim().toLowerCase()];
      if (spec === undefined || metadataRow.provider_type !== spec.providerType) {
        return {
          status: 400 as const,
          body: {
            error: 'This test-send boundary supports Resend email and Twilio SMS, WhatsApp, and Voice connectors only.',
          },
        };
      }

      const recipient = normalizeRecipient(spec.providerType, recipientInput);
      if (recipient === null) {
        return {
          status: 400 as const,
          body: {
            error: spec.providerType === 'email'
              ? 'A valid test recipient email is required.'
              : 'A valid E.164 test recipient phone number is required.',
          },
        };
      }
      if (spec.providerType === 'voice' && !isHttpsUrl(voiceUrl)) {
        return {
          status: 400 as const,
          body: { error: 'Twilio Voice test sends require an HTTPS TwiML voiceUrl.' },
        };
      }

      const providerRegistry = new PostgresProviderRegistryRepository(client);
      const connectors = await providerRegistry.listConnectors(
        context.tenantId,
        spec.capabilityKey,
      );
      const policy = await providerRegistry.loadRoutingPolicy(
        context.tenantId,
        spec.capabilityKey,
      );

      const selected = connectors.filter(
        (connector) => connector.connectorKey === connectorKey,
      );
      if (selected.length !== 1) {
        return {
          status: 409 as const,
          body: { error: 'The connector is not eligible for its configured communication capability.' },
        };
      }
      const selectedConnector = selected[0]!;

      const dispatch: PreparedCommunicationDispatch = {
        tenantId: context.tenantId,
        ...(context.organizationId === null || context.organizationId === ''
          ? {}
          : { organizationId: context.organizationId }),
        triggerKey: 'communications.test-send',
        purpose: 'system',
        channel: spec.providerType,
        recipient: spec.providerType === 'email' ? { email: recipient } : { phone: recipient },
        recipientKey: recipient,
        idempotencyKey,
        templateScope: 'PLATFORM',
        rendered: {
          templateId: `platform-${spec.providerType}-test-send`,
          version: 1,
          channel: spec.providerType,
          locale: 'en',
          format: 'TEXT',
          ...(spec.providerType === 'email' ? { subject: 'EXPADIO communication test' } : {}),
          body: spec.providerType === 'voice'
            ? voiceUrl
            : 'Your EXPADIO communication connector completed a governed test send.',
          variables: {},
        },
        compliance: {
          preflight: {
            allowed: true,
            reasonCode: 'OK',
            reason: 'Explicit step-up authenticated operator test send.',
          },
          evaluatedAt: requestedAt,
        },
        routing: { capabilityKey: spec.capabilityKey },
        requestedAt,
      };

      const routed = routePreparedCommunicationDispatch(
        dispatch,
        selected,
        policy ?? undefined,
      );
      if (!routed.routed) {
        return {
          status: 409 as const,
          body: {
            error: 'The selected connector is not currently eligible for communication routing.',
            reasonCode: routed.reasonCode,
            routeReason: routed.routeReason,
          },
        };
      }

      const senderPrepared = await prepareCommunicationProviderSendRequest({
        dispatch,
        senderRepository: new PostgresCommunicationSenderRepository(client),
        platformFallback: 'DENY',
      });
      if (!senderPrepared.ok) {
        return {
          status: 409 as const,
          body: {
            error: `Create and verify a ${spec.providerType} sender identity before testing.`,
            reasonCode: senderPrepared.reasonCode,
          },
        };
      }

      const credentialRepository = new PostgresConnectorCredentialRepository(client);
      const leaseService = createGovernedCredentialLeaseRuntime({
        client,
        contextProvider: {
          async resolve() {
            return {
              subjectId: context.subjectId,
              actorKind: 'user',
              tenantId: context.tenantId,
              organizationId: context.organizationId ?? '',
            };
          },
        },
      });

      let providerResult: CommunicationProviderSendResult;
      if (spec.providerKey === 'resend') {
        const adapter = new ResendEmailAdapter({
          apiToken: governedResendApiTokenProvider({
            connector: selectedConnector,
            credentialRepository,
            leaseService,
            secretResolver: delegatedSecretResolver,
            requestedBySubjectId: context.subjectId,
            requestId: () => crypto.randomUUID(),
            correlationId: () => crypto.randomUUID(),
          }),
        });
        providerResult = await adapter.send(senderPrepared.request);
      } else {
        const credentials = governedTwilioCredentialsProvider({
          connector: selectedConnector,
          credentialRepository,
          leaseService,
          secretResolver: delegatedSecretResolver,
          requestedBySubjectId: context.subjectId,
          requestId: () => crypto.randomUUID(),
          correlationId: () => crypto.randomUUID(),
        });
        const adapter = spec.providerKey === 'twilio-voice'
          ? new TwilioVoiceAdapter({ credentials })
          : new TwilioSmsWhatsappAdapter({ credentials });
        providerResult = await adapter.send(senderPrepared.request);
      }

      const traceBuilder = new DecisionTraceBuilder();
      traceBuilder
        .pass('INTENT_VALIDATION', 'explicit step-up authenticated test recipient')
        .pass('SENDER_DOMAIN', `verified sender scope ${senderPrepared.senderScope}`);
      traceBuilder.routing({
        considered: routed.considered,
        rejected: routed.rejected,
      });
      traceBuilder
        .pass('CONNECTOR_ROUTING', `selected ${connectorKey}`)
        .pass('CREDENTIAL_LEASE', 'authorized, audited, short-lived credential lease issued')
        .pass('DISPATCH', `test message handed to ${spec.providerKey}`);

      if (providerResult.status === 'ACCEPTED') {
        traceBuilder.pass('OUTCOME_CLASSIFICATION', 'provider accepted test message');
      } else {
        traceBuilder.fail(
          'OUTCOME_CLASSIFICATION',
          providerResult.reason ?? providerResult.reasonCode,
        );
      }

      const trace = traceBuilder.build({
        traceId: crypto.randomUUID(),
        tenantId: context.tenantId,
        ...(context.organizationId === null || context.organizationId === ''
          ? {}
          : { organizationId: context.organizationId }),
        kind: 'DISPATCH',
        outcome: providerResult.status === 'ACCEPTED' ? 'SENT' : 'FAILED',
        reasonCode: providerResult.status === 'ACCEPTED'
          ? 'TEST_SEND_OK'
          : `TEST_SEND_${providerResult.reasonCode}`,
        correlationId: crypto.randomUUID(),
        createdAt: requestedAt,
      });

      await client.query(
        `INSERT INTO platform.communication_decision_traces
           (trace_id, tenant_id, organization_id, message_id, kind, outcome, reason_code,
            stopped_at_gate, gates, connectors_considered, connectors_rejected,
            compliance_pack_versions, correlation_id, expires_at, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, $4, $5, $6, $7,
                 $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13::timestamptz, $14::timestamptz)`,
        [
          trace.traceId,
          trace.tenantId,
          trace.organizationId ?? null,
          trace.kind,
          trace.outcome,
          trace.reasonCode ?? null,
          trace.stoppedAtGate ?? null,
          JSON.stringify(trace.gates),
          JSON.stringify(trace.connectorsConsidered),
          JSON.stringify(trace.connectorsRejected),
          JSON.stringify(trace.compliancePackVersions),
          trace.correlationId,
          trace.expiresAt,
          trace.createdAt,
        ],
      );

      return {
        status: providerResult.status === 'ACCEPTED' ? 200 as const : 502 as const,
        body: {
          connectorKey,
          providerKey: spec.providerKey,
          channel: spec.providerType,
          traceId: trace.traceId,
          senderScope: senderPrepared.senderScope,
          outcome: providerResult.status,
          reasonCode: providerResult.reasonCode,
          ...(providerResult.providerMessageId === undefined
            ? {}
            : { providerMessageId: providerResult.providerMessageId }),
          ...(providerResult.reason === undefined
            ? {}
            : { reason: providerResult.reason }),
        },
      };
    });

    return NextResponse.json(result.body, {
      status: result.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

function normalizeRecipient(channel: TestChannel, value: string): string | null {
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
