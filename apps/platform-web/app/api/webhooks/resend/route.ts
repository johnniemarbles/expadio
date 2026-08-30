import { NextResponse } from 'next/server';
import { dbPool } from '../../../../lib/iam-adapter';
import { ingestVerifiedCommunicationProviderWebhook } from '../../../../lib/communication-provider-webhook';
import { verifyResendWebhookSignature } from '../../../../lib/resend-webhook-verification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function singleParam(searchParams: URLSearchParams, key: string): string | undefined {
  const value = searchParams.get(key)?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function requiredParam(searchParams: URLSearchParams, key: string): string {
  const value = singleParam(searchParams, key);
  if (value === undefined || /[\r\n\t]/u.test(value)) throw new Error(`${key.toUpperCase()}_REQUIRED`);
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function providerMessageId(payload: Record<string, unknown>): string | null {
  const data = asRecord(payload.data);
  return stringField(data.id)
    ?? stringField(data.email_id)
    ?? stringField(data.emailId)
    ?? stringField(payload.email_id)
    ?? stringField(payload.emailId);
}

function providerEventType(payload: Record<string, unknown>): string {
  return stringField(payload.type)
    ?? stringField(payload.event)
    ?? stringField(payload.event_type)
    ?? 'unknown';
}

/**
 * Resend provider webhook endpoint.
 *
 * Trust boundary:
 * - No Clerk/user session is accepted here.
 * - Raw request body is verified before JSON parsing is trusted.
 * - Tenant and connector selection are explicit endpoint parameters, so a
 *   platform operator can register one Resend endpoint per tenant connector.
 * - Lifecycle mutation is delegated to ingestVerifiedCommunicationProviderWebhook,
 *   which writes append-only webhook evidence and updates the canonical delivery.
 */
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret === undefined || secret.trim() === '') {
    return NextResponse.json({ error: 'Resend webhook secret is not configured.' }, { status: 503 });
  }

  let tenantId: string;
  let connectorKey: string;
  try {
    const { searchParams } = new URL(request.url);
    tenantId = requiredParam(searchParams, 'tenantId');
    connectorKey = requiredParam(searchParams, 'connectorKey');
  } catch {
    return NextResponse.json({ error: 'tenantId and connectorKey are required.' }, { status: 400 });
  }

  const payload = await request.text();
  try {
    verifyResendWebhookSignature({
      secret,
      payload,
      headers: {
        id: request.headers.get('svix-id'),
        timestamp: request.headers.get('svix-timestamp'),
        signature: request.headers.get('svix-signature'),
      },
    });
  } catch {
    return NextResponse.json({ error: 'Invalid Resend webhook signature.' }, { status: 400 });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = asRecord(JSON.parse(payload));
  } catch {
    return NextResponse.json({ error: 'Invalid JSON webhook payload.' }, { status: 400 });
  }

  const providerEventId = request.headers.get('svix-id')?.trim();
  if (providerEventId === undefined || providerEventId === null || providerEventId === '') {
    return NextResponse.json({ error: 'Missing provider event id.' }, { status: 400 });
  }

  const client = await dbPool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);
    const result = await ingestVerifiedCommunicationProviderWebhook(client, {
      tenantId,
      providerKey: 'resend',
      connectorKey,
      providerEventId,
      providerMessageId: providerMessageId(parsed),
      eventType: providerEventType(parsed),
      payload: parsed,
      receivedAt: new Date(),
    });

    return NextResponse.json({ ok: true, result });
  } catch {
    return NextResponse.json({ error: 'Resend webhook could not be processed.' }, { status: 500 });
  } finally {
    await client.query('RESET app.tenant_id').catch(() => undefined);
    client.release();
  }
}
