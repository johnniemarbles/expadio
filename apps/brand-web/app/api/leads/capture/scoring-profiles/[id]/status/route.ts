import { NextResponse } from 'next/server';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }
    const scoringProfileId = decodeURIComponent((await params).id).trim();
    if (!UUID.test(scoringProfileId)) {
      return NextResponse.json({ error: 'Invalid scoring profile identifier.' }, { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    const targetStatus = typeof body.status === 'string' ? body.status.trim().toUpperCase() : '';
    if (targetStatus !== 'ACTIVE' && targetStatus !== 'RETIRED') {
      return NextResponse.json({ error: 'status must be ACTIVE or RETIRED.' }, { status: 400 });
    }

    return await withBrandTransaction(context, async (client) => {
      const module = await loadTenantProductModule(client, {
        tenantId: context.tenantId,
        moduleKey: 'lead-management',
      });
      if (module?.availability !== 'ACTIVE') {
        return NextResponse.json({ denied: true, reasonKey: 'LEAD_MODULE_NOT_ACTIVE' }, { status: 403 });
      }
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }

      const current = await client.query<{
        profile_key: string;
        status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
      }>(
        `SELECT profile_key, status
           FROM platform.lead_scoring_profiles
          WHERE tenant_id = $1::uuid
            AND organization_id = $2::uuid
            AND scoring_profile_id = $3::uuid
          FOR UPDATE`,
        [context.tenantId, context.organizationId, scoringProfileId],
      );
      const row = current.rows[0];
      if (!row) return NextResponse.json({ error: 'Scoring profile not found.' }, { status: 404 });
      if (row.status === targetStatus) {
        return NextResponse.json({ success: true, scoringProfileId, status: targetStatus, replayed: true });
      }
      if (row.status === 'RETIRED') {
        return NextResponse.json({
          denied: true,
          reasonKey: 'SCORING_PROFILE_RETIRED',
          message: 'Retired scoring profiles cannot be reactivated.',
        }, { status: 409 });
      }

      if (targetStatus === 'ACTIVE') {
        if (row.status !== 'DRAFT') {
          return NextResponse.json({ error: 'Only DRAFT scoring profiles may be activated.' }, { status: 409 });
        }
        const existing = await client.query(
          `SELECT 1
             FROM platform.lead_scoring_profiles
            WHERE tenant_id = $1::uuid
              AND organization_id = $2::uuid
              AND profile_key = $3
              AND status = 'ACTIVE'
              AND scoring_profile_id <> $4::uuid
            LIMIT 1`,
          [context.tenantId, context.organizationId, row.profile_key, scoringProfileId],
        );
        if (existing.rows.length > 0) {
          return NextResponse.json({
            denied: true,
            reasonKey: 'SCORING_PROFILE_ACTIVE_CONFLICT',
            message: 'Retire the current active profile version before activating this draft.',
          }, { status: 409 });
        }
        await client.query(
          `UPDATE platform.lead_scoring_profiles
              SET status='ACTIVE', activated_at=clock_timestamp(), retired_at=NULL
            WHERE tenant_id=$1::uuid AND organization_id=$2::uuid AND scoring_profile_id=$3::uuid`,
          [context.tenantId, context.organizationId, scoringProfileId],
        );
      } else {
        await client.query(
          `UPDATE platform.lead_scoring_profiles
              SET status='RETIRED', retired_at=clock_timestamp()
            WHERE tenant_id=$1::uuid AND organization_id=$2::uuid AND scoring_profile_id=$3::uuid`,
          [context.tenantId, context.organizationId, scoringProfileId],
        );
      }

      return NextResponse.json({ success: true, scoringProfileId, status: targetStatus, replayed: false });
    });
  } catch (error) {
    console.error('Brand Demand Capture scoring profile lifecycle failed:', error);
    return NextResponse.json({ error: 'Unable to update scoring profile.' }, { status: 500 });
  }
}
