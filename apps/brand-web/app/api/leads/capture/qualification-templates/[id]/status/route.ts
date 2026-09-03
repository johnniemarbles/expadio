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
    if (!context.organizationId) return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    const templateId = decodeURIComponent((await params).id).trim();
    if (!UUID.test(templateId)) return NextResponse.json({ error: 'Invalid qualification template identifier.' }, { status: 400 });
    const body = await request.json().catch(() => ({}));
    const targetStatus = typeof body.status === 'string' ? body.status.trim().toUpperCase() : '';
    if (targetStatus !== 'ACTIVE' && targetStatus !== 'RETIRED') {
      return NextResponse.json({ error: 'status must be ACTIVE or RETIRED.' }, { status: 400 });
    }

    return await withBrandTransaction(context, async (client) => {
      const module = await loadTenantProductModule(client, { tenantId: context.tenantId, moduleKey: 'lead-management' });
      if (module?.availability !== 'ACTIVE') return NextResponse.json({ denied: true, reasonKey: 'LEAD_MODULE_NOT_ACTIVE' }, { status: 403 });
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }
      const current = await client.query<{ template_key: string; status: 'DRAFT' | 'ACTIVE' | 'RETIRED' }>(
        `SELECT template_key, status
           FROM platform.lead_qualification_templates
          WHERE tenant_id=$1::uuid AND organization_id=$2::uuid AND qualification_template_id=$3::uuid
          FOR UPDATE`,
        [context.tenantId, context.organizationId, templateId],
      );
      const row = current.rows[0];
      if (!row) return NextResponse.json({ error: 'Qualification template not found.' }, { status: 404 });
      if (row.status === targetStatus) return NextResponse.json({ success: true, qualificationTemplateId: templateId, status: targetStatus, replayed: true });
      if (row.status === 'RETIRED') {
        return NextResponse.json({ denied: true, reasonKey: 'QUALIFICATION_TEMPLATE_RETIRED', message: 'Retired qualification templates cannot be reactivated.' }, { status: 409 });
      }
      if (targetStatus === 'ACTIVE') {
        if (row.status !== 'DRAFT') return NextResponse.json({ error: 'Only DRAFT qualification templates may be activated.' }, { status: 409 });
        const existing = await client.query(
          `SELECT 1 FROM platform.lead_qualification_templates
            WHERE tenant_id=$1::uuid AND organization_id=$2::uuid AND template_key=$3
              AND status='ACTIVE' AND qualification_template_id<>$4::uuid LIMIT 1`,
          [context.tenantId, context.organizationId, row.template_key, templateId],
        );
        if (existing.rows.length > 0) {
          return NextResponse.json({ denied: true, reasonKey: 'QUALIFICATION_TEMPLATE_ACTIVE_CONFLICT', message: 'Retire the current active template version before activating this draft.' }, { status: 409 });
        }
        await client.query(
          `UPDATE platform.lead_qualification_templates
              SET status='ACTIVE', activated_at=clock_timestamp(), retired_at=NULL
            WHERE tenant_id=$1::uuid AND organization_id=$2::uuid AND qualification_template_id=$3::uuid`,
          [context.tenantId, context.organizationId, templateId],
        );
      } else {
        await client.query(
          `UPDATE platform.lead_qualification_templates
              SET status='RETIRED', retired_at=clock_timestamp()
            WHERE tenant_id=$1::uuid AND organization_id=$2::uuid AND qualification_template_id=$3::uuid`,
          [context.tenantId, context.organizationId, templateId],
        );
      }
      return NextResponse.json({ success: true, qualificationTemplateId: templateId, status: targetStatus, replayed: false });
    });
  } catch (error) {
    console.error('Brand qualification template lifecycle failed:', error);
    return NextResponse.json({ error: 'Unable to update qualification template.' }, { status: 500 });
  }
}
