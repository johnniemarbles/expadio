import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, withTenantTransaction, deniedResponse } from '../../../../../lib/request-context';
import { hasPlatformAdministrationRole } from '../../../../../lib/governance-authz';

/**
 * Retire a sending domain. Soft retirement (status INACTIVE, verification
 * REVOKED) rather than a hard delete, so delivery history that references the
 * sender identity stays intact.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ senderId: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const senderId = decodeURIComponent((await params).senderId);
    const platformAuthorized = await withTenantTransaction(
      context,
      (client) => hasPlatformAdministrationRole(client, context.subjectId),
    );
    if (!platformAuthorized) {
      return NextResponse.json(
        { denied: true, reasonKey: 'PLATFORM_ADMIN_REQUIRED', message: 'Only Platform Administration can retire platform senders.' },
        { status: 403 },
      );
    }

    const retired = await withTenantClient(context, async (client) => {
      await client.query("SELECT set_config('app.platform_admin', 'true', false)");
      const result = await client.query(
        `UPDATE platform.communication_sender_identities
            SET status = 'INACTIVE', verification_status = 'REVOKED', updated_at = now()
          WHERE sender_id = $1::uuid
            AND scope = 'PLATFORM'
            AND tenant_id IS NULL
          RETURNING sender_id, address, status, verification_status`,
        [senderId],
      );
      return result.rows[0] ?? null;
    });

    if (retired === null) {
      return NextResponse.json({ error: 'That sending domain was not found.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, sender: retired });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
