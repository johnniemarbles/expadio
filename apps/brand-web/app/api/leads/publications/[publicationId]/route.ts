import { NextResponse } from 'next/server';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Action = 'ACTIVATE' | 'PAUSE' | 'ARCHIVE';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ publicationId: string }> },
) {
  try {
    const { publicationId } = await params;
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }

    const body = await request.json();
    const action = (typeof body.action === 'string' ? body.action.trim().toUpperCase() : '') as Action;
    if (!['ACTIVATE', 'PAUSE', 'ARCHIVE'].includes(action)) {
      return NextResponse.json({ error: 'action must be one of: ACTIVATE, PAUSE, ARCHIVE' }, { status: 400 });
    }

    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId!)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }

      const { rows } = await client.query<{ status: string }>(
        `SELECT status FROM platform.lead_publications
         WHERE publication_id = $1::uuid AND tenant_id = $2::uuid AND organization_id = $3::uuid`,
        [publicationId, context.tenantId, context.organizationId],
      );
      if (rows.length === 0) {
        return NextResponse.json({ error: 'Publication not found.' }, { status: 404 });
      }
      const currentStatus = rows[0].status;

      let newStatus: string;
      let extraSet = '';

      if (action === 'ACTIVATE') {
        if (currentStatus !== 'DRAFT' && currentStatus !== 'PAUSED') {
          return NextResponse.json(
            { error: `Cannot activate a publication with status ${currentStatus}.` },
            { status: 409 },
          );
        }
        newStatus = 'ACTIVE';
        // activated_at must be non-null when status = ACTIVE (DB constraint)
        extraSet = ', activated_at = COALESCE(activated_at, clock_timestamp())';
      } else if (action === 'PAUSE') {
        if (currentStatus !== 'ACTIVE') {
          return NextResponse.json(
            { error: `Cannot pause a publication with status ${currentStatus}.` },
            { status: 409 },
          );
        }
        newStatus = 'PAUSED';
      } else {
        if (currentStatus === 'ARCHIVED') {
          return NextResponse.json({ error: 'Publication is already archived.' }, { status: 409 });
        }
        newStatus = 'ARCHIVED';
        // archived_at must be non-null when status = ARCHIVED (DB constraint)
        extraSet = ', archived_at = clock_timestamp()';
      }

      await client.query(
        `UPDATE platform.lead_publications
         SET status = $1${extraSet}
         WHERE publication_id = $2::uuid AND tenant_id = $3::uuid AND organization_id = $4::uuid`,
        [newStatus, publicationId, context.tenantId, context.organizationId],
      );

      return NextResponse.json({ success: true, publicationId, status: newStatus });
    });
  } catch (error) {
    console.error('Publication status update failed:', error);
    return NextResponse.json({ error: 'Unable to update publication.' }, { status: 500 });
  }
}
