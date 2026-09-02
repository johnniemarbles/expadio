import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { TwilioWebhookNormalizer } from '@expadio/communication/twilio-webhook-normalizer';
import { governedTwilioCredentialsProvider } from '@expadio/communication/governed-twilio-binding';
import {
  PostgresConnectorCredentialRepository,
  PostgresProviderRegistryRepository,
} from '@expadio/postgres-runtime/provider-registry';
import { createGovernedCredentialLeaseRuntime } from '@expadio/postgres-runtime/governed-credential-lease-runtime';
import { dbPool } from '../../../../lib/iam-adapter';
import { delegatedSecretResolver } from '../../../../lib/vault-secret-resolver';
import {
  ingestVerifiedCommunicationProviderWebhook,
  type CommunicationWebhookProviderKey,
} from '../../../../lib/communication-provider-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_ORGANIZATION_AUTH_CONTEXT = '00000000-0000-0000-0000-000000000000';
const CAPABILITY_BY_PROVIDER: Readonly<Record<string, string>> = {
  'twilio-sms': 'communication.sms.send',
  'twilio-whatsapp': 'communication.whatsapp.send',
  'twilio-voice': 'communication.voice.dial',
};

function requiredParam(searchParams: URLSearchParams, key: string): string {
  const value = searchParams.get(key)?.trim() ?? '';
  if (value === '' || /[\r\n\t]/u.test(value)) throw new Error(`${key.toUpperCase()}_REQUIRED`);
  return value;
}

function payloadRecord(rawBody: Uint8Array): Record<string, unknown> {
  const params = new URLSearchParams(Buffer.from(rawBody).toString('utf8'));
  const payload: Record<string, unknown> = {};
  for (const [key, value] of params.entries()) payload[key] = value;
  return payload;
}

/**
 * Twilio provider webhook endpoint.
 *
 * Trust boundary:
 * - no browser/user session establishes trust;
 * - tenant + connector are explicit endpoint coordinates;
 * - X-Twilio-Signature is verified against the exact request URL and raw form
 *   payload before callback data may mutate delivery state;
 * - the Twilio auth token is resolved through the governed credential lease
 *   boundary used by outbound execution, never directly from connector rows or
 *   process environment;
 * - verified callbacks flow through canonical append-only provider webhook
 *   evidence and delivery lifecycle reconciliation.
 */
export async function POST(request: Request) {
  let tenantId: string;
  let connectorKey: string;
  try {
    const { searchParams } = new URL(request.url);
    tenantId = requiredParam(searchParams, 'tenantId');
    connectorKey = requiredParam(searchParams, 'connectorKey');
  } catch {
    return NextResponse.json({ error: 'tenantId and connectorKey are required.' }, { status: 400 });
  }

  const serviceSubjectId = process.env.EXPADIO_COMMUNICATION_WORKER_SUBJECT_ID?.trim() ?? '';
  if (serviceSubjectId === '') {
    return NextResponse.json(
      { error: 'Communication webhook credential service identity is not configured.' },
      { status: 503 },
    );
  }

  const receivedAt = new Date();
  const rawBody = new Uint8Array(await request.arrayBuffer());
  const client = await dbPool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);

    const registry = new PostgresProviderRegistryRepository(client);
    const metadata = await client.query<{ provider_key: string; provider_type: string }>(
      `SELECT provider_key, provider_type
         FROM platform.connectors
        WHERE connector_key = $2
          AND (tenant_id IS NULL OR tenant_id = $1::uuid)
        LIMIT 1`,
      [tenantId, connectorKey],
    );
    const metadataRow = metadata.rows[0];
    const providerKey = metadataRow?.provider_key?.trim().toLowerCase() ?? '';
    const capabilityKey = CAPABILITY_BY_PROVIDER[providerKey];
    if (metadataRow === undefined || capabilityKey === undefined) {
      return NextResponse.json({ error: 'Twilio communication connector was not found.' }, { status: 404 });
    }

    const connectors = await registry.listConnectors(tenantId, capabilityKey);
    const connector = connectors.find((candidate) => candidate.connectorKey === connectorKey);
    if (connector === undefined || !connector.enabled) {
      return NextResponse.json({ error: 'Twilio communication connector is not enabled.' }, { status: 409 });
    }

    const credentialRepository = new PostgresConnectorCredentialRepository(client);
    const credentialNow = () => receivedAt.toISOString();
    const leaseService = createGovernedCredentialLeaseRuntime({
      client,
      contextProvider: {
        async resolve() {
          return {
            subjectId: serviceSubjectId,
            actorKind: 'service',
            tenantId,
            organizationId: NO_ORGANIZATION_AUTH_CONTEXT,
          };
        },
      },
      now: credentialNow,
    });
    const credentials = governedTwilioCredentialsProvider({
      connector,
      credentialRepository,
      leaseService,
      secretResolver: delegatedSecretResolver,
      requestedBySubjectId: serviceSubjectId,
      requestId: () => randomUUID(),
      correlationId: () => randomUUID(),
      now: credentialNow,
    });

    const adapterKey = providerKey === 'twilio-voice'
      ? 'twilio-voice-v1' as const
      : 'twilio-sms-whatsapp-v1' as const;
    const normalizer = new TwilioWebhookNormalizer({
      adapterKey,
      async resolveAuthToken() {
        const resolved = await credentials({
          tenantId,
          triggerKey: 'communications.provider-webhook.verify',
          idempotencyKey: `twilio-webhook-${randomUUID()}`,
          purpose: 'system',
          requestedAt: receivedAt.toISOString(),
        });
        return resolved.authToken;
      },
      getWebhookUrl: () => request.url,
      now: () => receivedAt.toISOString(),
    });

    const normalized = await normalizer.verifyAndNormalize({
      connectorKey,
      headers: {
        'x-twilio-signature': request.headers.get('x-twilio-signature') ?? undefined,
      },
      rawBody,
    });
    if (!normalized.verified) {
      return NextResponse.json(
        { error: 'Invalid Twilio webhook.', reasonCode: normalized.reasonCode },
        { status: 400 },
      );
    }

    const expectedChannel = metadataRow.provider_type;
    const payload = payloadRecord(rawBody);
    const results = [];
    for (const event of normalized.events) {
      if (event.channel !== expectedChannel) {
        return NextResponse.json(
          { error: 'Twilio webhook channel does not match connector configuration.' },
          { status: 400 },
        );
      }
      results.push(await ingestVerifiedCommunicationProviderWebhook(client, {
        tenantId,
        providerKey: providerKey as CommunicationWebhookProviderKey,
        connectorKey,
        providerEventId: event.providerEventId,
        providerMessageId: event.providerMessageId,
        eventType: event.state,
        payload,
        receivedAt,
      }));
    }

    return NextResponse.json({ ok: true, accepted: normalized.events.length, results }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown webhook processing error.';
    const credentialFailure = message.startsWith('TWILIO_')
      || message.includes('CREDENTIAL')
      || message.includes('credential');
    return NextResponse.json(
      { error: credentialFailure ? 'Twilio webhook credential verification is unavailable.' : 'Twilio webhook could not be processed.' },
      { status: credentialFailure ? 503 : 500 },
    );
  } finally {
    await client.query('RESET app.tenant_id').catch(() => undefined);
    client.release();
  }
}
