import { NextResponse } from 'next/server';
import { PostgresCommunicationSuppressionRepository } from '@expadio/postgres-runtime/suppression';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ suppressionId: string }> },
) {
  try {
    const context = await resolveBrandContext();
    const suppressionId = decodeURIComponent((await params).suppressionId);

    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand communication administration is required.' }, { status: 403 });
      }

      const owned = await client.query(
        `SELECT 1
           FROM platform.communication_suppressions
          WHERE suppression_id = $1::uuid
            AND tenant_id = $2::uuid
            AND organization_id = $3::uuid
            AND status = 'ACTIVE'
          LIMIT 1`,
        [suppressionId, context.tenantId, context.organizationId],
      );
      if (owned.rows.length === 0) {
        return NextResponse.json({ error: 'Active organization suppression not found.' }, { status: 404 });
      }

      const repository = new PostgresCommunicationSuppressionRepository(client);
      const revoked = await repository.revoke({ tenantId: context.tenantId, suppressionId });
      if (!revoked) return NextResponse.json({ error: 'Suppression could not be revoked.' }, { status: 409 });
      return NextResponse.json({ success: true, suppressionId, status: 'REVOKED' });
    });
  } catch (error) {
    console.error('Brand suppression revocation failed:', error);
    return NextResponse.json({ error: 'Unable to revoke organization suppression.' }, { status: 500 });
  }
}
