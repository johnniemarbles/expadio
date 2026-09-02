import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantTransaction, deniedResponse } from '../../../../../lib/request-context';
import { hasPlatformAdministrationRole } from '../../../../../lib/governance-authz';
import { requireCommunicationDomainAdmin } from '../../../../../lib/communication-domain-admin';

/**
 * Retire a sending-domain sender identity without deleting delivery evidence.
 * Tenant identities are governed by tenant/platform communication admins;
 * platform identities remain restricted to Platform Administration.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ senderId: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const senderId = decodeURIComponent((await params).senderId);
    if (!UUID_RE.test(senderId)) {
      return NextResponse.json({ error: 'senderId must be a valid UUID.' }, { status: 400 });
    }

    const outcome = await withTenantTransaction(context, async (client) => {
      const existing = await client.query<{ scope: 'PLATFORM' | 'TENANT'; tenant_id: string | null }>(
        `SELECT scope, tenant_id
           FROM platform.communication_sender_identities
          WHERE sender_id = $1::uuid
            AND channel = 'email'
            AND (
              scope = 'PLATFORM'
              OR (scope = 'TENANT' AND tenant_id = $2::uuid)
            )
          LIMIT 1`,
        [senderId, context.tenantId],
      );
      const sender = existing.rows[0];
      if (sender === undefined) return { kind: 'NOT_FOUND' as const };

      if (sender.scope === 'PLATFORM') {
        if (!(await hasPlatformAdministrationRole(client, context.subjectId))) {
          return { kind: 'DENIED' as const, reasonKey: 'PLATFORM_ADMIN_REQUIRED' };
        }
        await client.query("SELECT set_config('app.platform_admin', 'true', true)");
      } else if (!(await requireCommunicationDomainAdmin(client, context.subjectId, context.tenantId))) {
        return { kind: 'DENIED' as const, reasonKey: 'FORBIDDEN' };
      }

      const retired = await client.query(
        `UPDATE platform.communication_sender_identities
            SET status = 'INACTIVE',
                verification_status = 'REVOKED',
                is_default = false,
                updated_at = now()
          WHERE sender_id = $1::uuid
            AND channel = 'email'
            AND (
              (scope = 'PLATFORM' AND $3::boolean = true)
              OR (scope = 'TENANT' AND tenant_id = $2::uuid)
            )
          RETURNING sender_id, scope, address, status, verification_status, is_default`,
        [senderId, context.tenantId, sender.scope === 'PLATFORM'],
      );
      return retired.rows[0] === undefined
        ? { kind: 'NOT_FOUND' as const }
        : { kind: 'OK' as const, sender: retired.rows[0] };
    });

    if (outcome.kind === 'DENIED') {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: outcome.reasonKey,
          message: outcome.reasonKey === 'PLATFORM_ADMIN_REQUIRED'
            ? 'Only Platform Administration can retire platform senders.'
            : 'Sending-domain administration is required.',
        },
        { status: 403 },
      );
    }
    if (outcome.kind === 'NOT_FOUND') {
      return NextResponse.json({ error: 'That sending domain was not found.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, sender: outcome.sender });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
