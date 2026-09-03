import { NextResponse } from 'next/server';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../../lib/brand-context';
import { routeDemandCaptureLead } from '../../../../../../lib/demand-capture-routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }

    const captureLeadId = decodeURIComponent((await params).id).trim();
    if (!UUID.test(captureLeadId)) {
      return NextResponse.json({ error: 'Invalid capture Lead identifier.' }, { status: 400 });
    }

    return await withBrandTransaction(context, async (client) => {
      const module = await loadTenantProductModule(client, {
        tenantId: context.tenantId,
        moduleKey: 'lead-management',
      });
      if (module?.availability !== 'ACTIVE') {
        return NextResponse.json({ denied: true, reasonKey: 'LEAD_MODULE_NOT_ACTIVE' }, { status: 403 });
      }

      const visible = await client.query<{ organization_id: string }>(
        `SELECT organization_id
           FROM platform.lead_capture_leads
          WHERE tenant_id = $1::uuid
            AND capture_lead_id = $2::uuid`,
        [context.tenantId, captureLeadId],
      );
      const lead = visible.rows[0];
      if (!lead) return NextResponse.json({ error: 'Demand Capture Lead not found.' }, { status: 404 });

      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, lead.organization_id)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }

      const routed = await routeDemandCaptureLead(client, {
        tenantId: context.tenantId,
        captureLeadId,
        actorSubjectId: context.subjectId,
        issuer: context.issuer,
      });
      if (!routed) return NextResponse.json({ error: 'Demand Capture Lead not found.' }, { status: 404 });

      return NextResponse.json({ success: true, ...routed });
    });
  } catch (error) {
    console.error('Brand Demand Capture routing failed:', error);
    return NextResponse.json({ error: 'Unable to route Demand Capture Lead.' }, { status: 500 });
  }
}
