import { NextResponse } from 'next/server';
import type { WrappedSecretEnvelope } from '@expadio/credential-custody';
import {
  deniedResponse,
  requireStepUp,
  resolveRequestContext,
} from '../../../../lib/request-context';
import { wrappingKeys } from '../wrapping-key/route';
import { intakeWebhookSigningSecret } from '../../../../lib/webhook-signing-secret';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isEnvelope(value: unknown): value is WrappedSecretEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.kid === 'string'
    && typeof candidate.epk === 'string'
    && typeof candidate.iv === 'string'
    && typeof candidate.ct === 'string'
    && typeof candidate.tag === 'string'
  );
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext();
    await requireStepUp();
    const body = await request.json().catch(() => null) as
      | { connectorKey?: unknown; providerKey?: unknown; envelope?: unknown }
      | null;

    const connectorKey = typeof body?.connectorKey === 'string' ? body.connectorKey.trim() : '';
    const providerKey = typeof body?.providerKey === 'string' ? body.providerKey.trim().toLowerCase() : '';

    if (providerKey !== 'resend') {
      return NextResponse.json(
        { error: 'Webhook signing-secret intake currently supports Resend only.' },
        { status: 400 },
      );
    }
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(connectorKey)) {
      return NextResponse.json({ error: 'connectorKey is invalid.' }, { status: 400 });
    }
    if (!isEnvelope(body?.envelope)) {
      return NextResponse.json(
        { error: 'The webhook secret envelope is missing or malformed.' },
        { status: 400 },
      );
    }

    const result = await intakeWebhookSigningSecret({
      tenantId: context.tenantId,
      connectorKey,
      envelope: body.envelope,
      wrappingKeys,
    });

    return NextResponse.json(
      { reference: result.reference, keyVersion: result.keyVersion, writtenAt: result.writtenAt },
      {
        status: 201,
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' },
      },
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('WEBHOOK_SECRET_')) {
      return NextResponse.json(
        { error: 'The webhook signing secret could not be stored.', reasonKey: error.message.split(':')[0] },
        { status: error.message.includes('WRAPPING_KEY_') ? 409 : 400 },
      );
    }
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
