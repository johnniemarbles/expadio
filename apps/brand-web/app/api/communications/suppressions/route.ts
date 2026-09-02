import { NextResponse } from 'next/server';
import { PostgresCommunicationSuppressionRepository } from '@expadio/postgres-runtime/suppression';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SuppressionChannel = 'email' | 'sms' | 'whatsapp' | 'voice' | 'push' | 'rcs';
type SuppressionReason = 'BOUNCE' | 'COMPLAINT' | 'OPT_OUT' | 'LEGAL_HOLD' | 'UNSUBSCRIBE';

const REASONS: readonly SuppressionReason[] = [
  'BOUNCE', 'COMPLAINT', 'OPT_OUT', 'LEGAL_HOLD', 'UNSUBSCRIBE',
];
const CHANNELS: readonly SuppressionChannel[] = ['email', 'sms', 'whatsapp', 'voice', 'push', 'rcs'];

export async function GET(request: Request) {
  try {
    const context = await resolveBrandContext();
    const url = new URL(request.url);
    const status = url.searchParams.get('status')?.trim().toUpperCase() ?? 'ACTIVE';
    const page = Math.max(Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100, 1), 250);
    if (!['ACTIVE', 'REVOKED', 'ALL'].includes(status)) {
      return NextResponse.json({ error: 'Unsupported suppression status filter.' }, { status: 400 });
    }

    return await withBrandTransaction(context, async (client) => {
      const result = await client.query(
        `SELECT suppression_id, recipient_key, channel, reason, status,
                source_message_id, recorded_at, valid_until, revoked_at
           FROM platform.communication_suppressions
          WHERE tenant_id = $1::uuid
            AND organization_id = $2::uuid
            AND ($3::text = 'ALL' OR status = $3)
          ORDER BY recorded_at DESC, suppression_id DESC
          LIMIT $4 OFFSET $5`,
        [context.tenantId, context.organizationId, status, limit + 1, (page - 1) * limit],
      );
      const hasMore = result.rows.length > limit;
      const rows = result.rows.slice(0, limit);
      return NextResponse.json({
        items: rows.map((row) => ({
          suppressionId: row.suppression_id,
          recipientKey: row.recipient_key,
          channel: row.channel,
          reason: row.reason,
          status: row.status,
          sourceMessageId: row.source_message_id,
          recordedAt: new Date(row.recorded_at).toISOString(),
          validUntil: row.valid_until ? new Date(row.valid_until).toISOString() : null,
          revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
        })),
        page,
        limit,
        hasMore,
      });
    });
  } catch (error) {
    console.error('Brand suppression read failed:', error);
    return NextResponse.json({ error: 'Unable to load organization suppressions.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const body = await request.json();
    const recipientKey = typeof body.recipientKey === 'string' ? body.recipientKey.trim() : '';
    const channel = typeof body.channel === 'string' ? body.channel.trim().toLowerCase() as SuppressionChannel : null;
    const reason = typeof body.reason === 'string' ? body.reason.trim().toUpperCase() as SuppressionReason : null;
    const validUntil = typeof body.validUntil === 'string' && body.validUntil.trim() ? body.validUntil.trim() : undefined;

    if (!recipientKey) return NextResponse.json({ error: 'recipientKey is required.' }, { status: 400 });
    if (!channel || !CHANNELS.includes(channel)) {
      return NextResponse.json({ error: 'Unsupported suppression channel.' }, { status: 400 });
    }
    if (!reason || !REASONS.includes(reason)) {
      return NextResponse.json({ error: 'Unsupported suppression reason.' }, { status: 400 });
    }
    if (validUntil && (!Number.isFinite(Date.parse(validUntil)) || Date.parse(validUntil) <= Date.now())) {
      return NextResponse.json({ error: 'validUntil must be a future timestamp.' }, { status: 400 });
    }

    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand communication administration is required.' }, { status: 403 });
      }
      try {
        const repository = new PostgresCommunicationSuppressionRepository(client);
        const created = await repository.add({
          tenantId: context.tenantId,
          organizationId: context.organizationId,
          recipientKey,
          channel,
          reason,
          ...(validUntil ? { validUntil: new Date(validUntil).toISOString() } : {}),
        });
        return NextResponse.json({ success: true, suppression: created }, { status: 201 });
      } catch (error: any) {
        if (error?.code === '23505') {
          return NextResponse.json({ error: 'An active organization suppression already exists for this recipient.' }, { status: 409 });
        }
        throw error;
      }
    });
  } catch (error) {
    console.error('Brand suppression creation failed:', error);
    return NextResponse.json({ error: 'Unable to create organization suppression.' }, { status: 500 });
  }
}
