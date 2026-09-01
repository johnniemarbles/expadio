import { NextResponse } from 'next/server';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../../../lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    if (!context.organizationId) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED',
          message: 'Select an active organization workspace to continue.',
        },
        { status: 403 },
      );
    }

    const rows = await withTenantTransaction(context, async (client) => {
      const result = await client.query(
        `SELECT
           plan.setup_plan_id,
           plan.enterprise_id,
           plan.organization_id,
           organization.name AS organization_name,
           organization.organization_kind,
           organization.status AS organization_status,
           organization.parent_organization_id,
           plan.state,
           plan.total_requirements,
           plan.completed_requirements,
           plan.blocking_open_requirements,
           plan.completion_percent,
           plan.started_at,
           plan.ready_at,
           plan.updated_at,
           closure.depth
         FROM platform.organization_closure closure
         JOIN platform.organization_setup_plans plan
           ON plan.tenant_id = closure.tenant_id
          AND plan.organization_id = closure.descendant_organization_id
         JOIN platform.organizations organization
           ON organization.tenant_id = plan.tenant_id
          AND organization.organization_id = plan.organization_id
         WHERE closure.tenant_id = $1::uuid
           AND closure.ancestor_organization_id = $2::uuid
           AND closure.depth > 0
           AND plan.state <> 'CANCELLED'
         ORDER BY
           CASE plan.state
             WHEN 'READY_FOR_ACTIVATION' THEN 0
             WHEN 'CONFIGURING' THEN 1
             WHEN 'PROVISIONING' THEN 2
             WHEN 'ACTIVATED' THEN 3
             ELSE 4
           END,
           closure.depth ASC,
           organization.name ASC`,
        [context.tenantId, context.organizationId],
      );
      return result.rows;
    });

    return NextResponse.json(
      { parentOrganizationId: context.organizationId, items: rows },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
