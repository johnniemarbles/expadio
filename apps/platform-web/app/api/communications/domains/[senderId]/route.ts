import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantTransaction, deniedResponse } from '../../../../../lib/request-context';
import { requireCommunicationDomainAdmin } from '../../../../../lib/communication-domain-admin';

/**
 * Retire a tenant/organization sending-domain sender identity without deleting
 * delivery evidence. Platform defaults are intentionally read-only at this
 * tenant-scoped boundary and require a separate Platform-owned mutation path.
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
    const senderId = decodeURIComponent((await params).senderId).trim();
    if (!UUID_RE.test(senderId)) {
      return NextResponse.json({ error: 'senderId must be a valid UUID.' }, { status: 400 });
    }

    const outcome = await withTenantTransaction(context, async (client) => {
      if (!(await requireCommunicationDomainAdmin(client, context.subjectId, context.tenantId))) {
        return { kind: 'DENIED' as const };
      }

      const retired = await client.query(
        `UPDATE platform.communication_sender_identities
            SET status = 'INACTIVE',
                verification_status = 'REVOKED',
                is_default = false,
                updated_at = now()
          WHERE sender_id = $1::uuid
            AND tenant_id = $2::uuid
            AND scope IN ('TENANT', 'ORGANIZATION')
            AND channel = 'email'
            AND status <> 'INACTIVE'
          RETURNING sender_id, scope, address, status, verification_status, is_default`,
        [senderId, context.tenantId],
      );
      return retired.rows[0] === undefined
        ? { kind: 'NOT_FOUND' as const }
        : { kind: 'OK' as const, sender: retired.rows[0] };
    });

    if (outcome.kind === 'DENIED') {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'Sending-domain administration is required.' },
        { status: 403 },
      );
    }
    if (outcome.kind === 'NOT_FOUND') {
      return NextResponse.json({ error: 'That tenant or organization sending domain was not found.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, sender: outcome.sender });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
