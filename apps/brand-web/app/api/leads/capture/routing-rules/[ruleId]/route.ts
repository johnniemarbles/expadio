import { NextResponse } from 'next/server';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const STATUSES = new Set(['ACTIVE', 'DISABLED']);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ ruleId: string }> },
) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }
    const routingRuleId = decodeURIComponent((await params).ruleId).trim();
    if (!UUID.test(routingRuleId)) return NextResponse.json({ error: 'Invalid routing rule identifier.' }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const status = typeof body.status === 'string' ? body.status.trim().toUpperCase() : '';
    if (!STATUSES.has(status)) return NextResponse.json({ error: 'Routing rule status must be ACTIVE or DISABLED.' }, { status: 400 });

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

      const changed = await client.query<{
        routing_rule_id: string;
        name: string;
        priority: number;
        target_subject_id: string;
        status: 'ACTIVE' | 'DISABLED';
      }>(
        `UPDATE platform.lead_capture_routing_rules
            SET status = $4,
                updated_at = clock_timestamp()
          WHERE tenant_id = $1::uuid
            AND organization_id = $2::uuid
            AND routing_rule_id = $3::uuid
          RETURNING routing_rule_id, name, priority, target_subject_id, status`,
        [context.tenantId, context.organizationId, routingRuleId, status],
      );
      const row = changed.rows[0];
      if (!row) return NextResponse.json({ error: 'Routing rule not found.' }, { status: 404 });

      return NextResponse.json({
        success: true,
        rule: {
          routingRuleId: row.routing_rule_id,
          name: row.name,
          priority: row.priority,
          targetSubjectId: row.target_subject_id,
          status: row.status,
        },
      });
    });
  } catch (error) {
    console.error('Brand Demand Capture routing rule status update failed:', error);
    return NextResponse.json({ error: 'Unable to update Demand Capture routing rule.' }, { status: 500 });
  }
}
