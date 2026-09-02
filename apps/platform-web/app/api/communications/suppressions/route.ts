import { NextResponse } from 'next/server';
import {
  communicationChannelMetadata,
  type CommunicationChannel,
  type CommunicationSuppressionReason,
} from '@expadio/communication';
import { PostgresCommunicationSuppressionRepository } from '@expadio/postgres-runtime/suppression';
import { deniedResponse, resolveRequestContext, withTenantClient } from '../../../../lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_ROLES = ['PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN', 'TENANT_OWNER', 'TENANT_ADMIN'];
const SUPPRESSION_REASONS: readonly CommunicationSuppressionReason[] = [
  'BOUNCE',
  'COMPLAINT',
  'OPT_OUT',
  'LEGAL_HOLD',
  'UNSUBSCRIBE',
];
const SUPPRESSION_CHANNELS: readonly CommunicationChannel[] = [
  'email',
  'sms',
  'whatsapp',
  'voice',
  'push',
  'rcs',
];

async function requireSuppressionAdmin(
  client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: unknown[] }> },
  subjectId: string,
  tenantId: string,
) {
  const role = await client.query(
    `SELECT 1
       FROM platform.authorization_assignments assignment
       JOIN platform.authorization_roles role ON role.role_id = assignment.role_id
      WHERE assignment.subject_id = $1
        AND assignment.status = 'ACTIVE'
        AND role.status = 'ACTIVE'
        AND role.role_key = ANY($2::text[])
        AND (assignment.valid_until IS NULL OR assignment.valid_until > now())
        AND (
          role.ownership_scope = 'PLATFORM'
          OR (role.ownership_scope = 'TENANT' AND role.tenant_id = $3::uuid)
        )
      LIMIT 1`,
    [subjectId, ADMIN_ROLES, tenantId],
  );
  return role.rows.length > 0;
}

export interface SuppressionListItem {
  suppressionId: string;
  organizationId: string | null;
  recipientKey: string;
  channel: CommunicationChannel;
  reason: CommunicationSuppressionReason;
  status: 'ACTIVE' | 'REVOKED';
  sourceMessageId: string | null;
  recordedAt: string;
  validUntil: string | null;
  revokedAt: string | null;
}

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const url = new URL(request.url);
    const channel = url.searchParams.get('channel')?.trim().toLowerCase() ?? '';
    const status = url.searchParams.get('status')?.trim().toUpperCase() ?? 'ACTIVE';
    const organizationId = url.searchParams.get('organizationId')?.trim() || null;
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 250);

    if (channel && !SUPPRESSION_CHANNELS.includes(channel as CommunicationChannel)) {
      return NextResponse.json({ error: 'Unsupported suppression channel.' }, { status: 400 });
    }
    if (!['ACTIVE', 'REVOKED', 'ALL'].includes(status)) {
      return NextResponse.json({ error: 'Unsupported suppression status filter.' }, { status: 400 });
    }

    return await withTenantClient(context, async (client) => {
      if (!(await requireSuppressionAdmin(client, context.subjectId, context.tenantId))) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Suppression administration is required.' }, { status: 403 });
      }

      const result = await client.query(
        `SELECT suppression_id, organization_id, recipient_key, channel, reason,
                status, source_message_id, recorded_at, valid_until, revoked_at
           FROM platform.communication_suppressions
          WHERE tenant_id = $1::uuid
            AND ($2::text = '' OR channel = $2)
            AND ($3::text = 'ALL' OR status = $3)
            AND ($4::uuid IS NULL OR organization_id = $4::uuid)
          ORDER BY recorded_at DESC
          LIMIT $5`,
        [context.tenantId, channel, status, organizationId, limit],
      );

      const items: SuppressionListItem[] = result.rows.map((row: any) => ({
        suppressionId: row.suppression_id,
        organizationId: row.organization_id,
        recipientKey: row.recipient_key,
        channel: row.channel,
        reason: row.reason,
        status: row.status,
        sourceMessageId: row.source_message_id,
        recordedAt: new Date(row.recorded_at).toISOString(),
        validUntil: row.valid_until ? new Date(row.valid_until).toISOString() : null,
        revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
      }));
      return NextResponse.json(items);
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = await request.json();
    const recipientKey = typeof body.recipientKey === 'string' ? body.recipientKey.trim() : '';
    const channel = typeof body.channel === 'string' ? body.channel.trim().toLowerCase() as CommunicationChannel : null;
    const reason = typeof body.reason === 'string' ? body.reason.trim().toUpperCase() as CommunicationSuppressionReason : null;
    const organizationId = typeof body.organizationId === 'string' && body.organizationId.trim() ? body.organizationId.trim() : undefined;
    const validUntil = typeof body.validUntil === 'string' && body.validUntil.trim() ? body.validUntil.trim() : undefined;

    if (!recipientKey) return NextResponse.json({ error: 'recipientKey is required.' }, { status: 400 });
    if (!channel || !SUPPRESSION_CHANNELS.includes(channel) || !communicationChannelMetadata(channel).supportsSuppression) {
      return NextResponse.json({ error: 'Unsupported suppression channel.' }, { status: 400 });
    }
    if (!reason || !SUPPRESSION_REASONS.includes(reason)) {
      return NextResponse.json({ error: 'Unsupported suppression reason.' }, { status: 400 });
    }
    if (validUntil && (!Number.isFinite(Date.parse(validUntil)) || Date.parse(validUntil) <= Date.now())) {
      return NextResponse.json({ error: 'validUntil must be a future timestamp.' }, { status: 400 });
    }

    return await withTenantClient(context, async (client) => {
      if (!(await requireSuppressionAdmin(client, context.subjectId, context.tenantId))) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Suppression administration is required.' }, { status: 403 });
      }

      if (organizationId) {
        const organization = await client.query(
          `SELECT 1 FROM platform.organizations WHERE tenant_id = $1::uuid AND organization_id = $2::uuid LIMIT 1`,
          [context.tenantId, organizationId],
        );
        if (organization.rows.length === 0) {
          return NextResponse.json({ error: 'Organization was not found in this tenant.' }, { status: 404 });
        }
      }

      try {
        const repository = new PostgresCommunicationSuppressionRepository(client);
        const created = await repository.add({
          tenantId: context.tenantId,
          ...(organizationId ? { organizationId } : {}),
          recipientKey,
          channel,
          reason,
          ...(validUntil ? { validUntil: new Date(validUntil).toISOString() } : {}),
        });
        return NextResponse.json({ success: true, suppression: created }, { status: 201 });
      } catch (error: any) {
        if (error?.code === '23505') {
          return NextResponse.json({ error: 'An active suppression already exists for this recipient and scope.' }, { status: 409 });
        }
        throw error;
      }
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
