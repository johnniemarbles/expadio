import { requireCommunicationAdmin } from '../../../../../../lib/communication-admin';
import { NextResponse } from 'next/server';
import { DecisionTraceBuilder } from '@expadio/communication';
import { governedResendApiTokenProvider } from '@expadio/communication/governed-resend-binding';
import { routePreparedCommunicationDispatch } from '@expadio/communication/dispatch-routing';
import { prepareCommunicationProviderSendRequest } from '@expadio/communication/provider-send-request';
import { ResendEmailAdapter } from '@expadio/communication/resend-email-adapter';
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

const CAPABILITY_KEY = 'communication.email.send';

interface TestSendBody {
  readonly recipient?: unknown;
  readonly idempotencyKey?: unknown;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    await requireCommunicationAdmin(context);
    await requireStepUp();

    const connectorKey = decodeURIComponent((await params).key).trim();
    const body = (await request.json()) as TestSendBody;
    const recipient = typeof body.recipient === 'string'
      ? body.recipient.trim().toLowerCase()
      : '';
    const idempotencyKey = typeof body.idempotencyKey === 'string'
      ? body.idempotencyKey.trim()
      : '';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(recipient)) {
      return NextResponse.json(
        { error: 'A valid test recipient email is required.' },
        { status: 400 },
      );
    }
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
      await client.query("SELECT set_config('app.platform_admin', 'true', true)");
      const providerRegistry = new PostgresProviderRegistryRepository(client);
      const connectors = await providerRegistry.listConnectors(
        context.tenantId,
        CAPABILITY_KEY,
      );
      const policy = await providerRegistry.loadRoutingPolicy(
        context.tenantId,
        CAPABILITY_KEY,
      );

      const selected = connectors.filter(
        (connector) => connector.connectorKey === connectorKey,
      );
      if (selected.length !== 1) {
        return {
          status: 404 as const,
          body: { error: 'Communication connector was not found.' },
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
        channel: 'email',
        recipient: { email: recipient },
        recipientKey: recipient,
        idempotencyKey,
        templateScope: 'PLATFORM',
        rendered: {
          templateId: 'platform-test-send',
          version: 1,
          channel: 'email',
          locale: 'en',
          format: 'TEXT',
          subject: 'EXPADIO communication test',
          body: 'Your EXPADIO communication connector completed a governed test send.',
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
        routing: { capabilityKey: CAPABILITY_KEY },
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
            error: 'The selected connector is not currently eligible for email routing.',
            reasonCode: routed.reasonCode,
            routeReason: routed.routeReason,
          },
        };
      }

      if (
        selectedConnector.providerKey !== 'resend'
        || selectedConnector.providerType !== 'email'
      ) {
        return {
          status: 400 as const,
          body: {
            error: 'This test-send boundary currently supports Resend email connectors only.',
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
            error: 'Create and verify a tenant sender identity before testing.',
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
      const providerResult = await adapter.send(senderPrepared.request);

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
        .pass('DISPATCH', 'test message handed to Resend');

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
