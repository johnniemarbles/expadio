import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../lib/request-context';

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

    const retired = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `UPDATE platform.communication_sender_identities
            SET status = 'INACTIVE', verification_status = 'REVOKED', updated_at = now()
          WHERE sender_id = $1::uuid
            AND (tenant_id = $2::uuid OR (scope = 'PLATFORM' AND $3::boolean))
          RETURNING sender_id, address, status, verification_status`,
        [senderId, context.tenantId, context.platformScope],
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
