import { NextResponse } from 'next/server';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ senderId: string }> },
) {
  try {
    const context = await resolveBrandContext();
    const senderId = decodeURIComponent((await params).senderId);
    if (!UUID_RE.test(senderId)) {
      return NextResponse.json({ error: 'senderId must be a valid UUID.' }, { status: 400 });
    }

    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand communication administration is required.' }, { status: 403 });
      }
      const result = await client.query(
        `UPDATE platform.communication_sender_identities
            SET status = 'INACTIVE', is_default = false, updated_at = now()
          WHERE sender_id = $1::uuid
            AND tenant_id = $2::uuid
            AND organization_id = $3::uuid
            AND scope = 'ORGANIZATION'
            AND channel = 'email'
            AND status <> 'INACTIVE'
          RETURNING sender_id, status, updated_at`,
        [senderId, context.tenantId, context.organizationId],
      );
      if (result.rows.length === 0) return NextResponse.json({ error: 'Active organization sender not found.' }, { status: 404 });
      return NextResponse.json({ success: true, sender: result.rows[0] });
    });
  } catch (error) {
    console.error('Brand sender retirement failed:', error);
    return NextResponse.json({ error: 'Unable to retire organization sender.' }, { status: 500 });
  }
}
