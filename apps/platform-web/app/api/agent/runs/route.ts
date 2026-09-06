import { NextResponse } from 'next/server';
import {
  ContextDenied,
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    if (!context.organizationId) {
      throw new ContextDenied(
        'ORGANIZATION_CONTEXT_REQUIRED',
        'Select an organization workspace to continue.',
        403,
      );
    }

    const result = await withTenantTransaction(context, async (client) =>
      client.query(
        `SELECT
           r.run_id AS session_id,
           r.created_at,
           r.agent_id,
           COALESCE(a.persona, c.display_name, r.agent_id) AS display_name,
           COALESCE(a.department, c.department, 'System') AS department,
           COALESCE(
             (
               SELECT sum(cost_minor_units)
               FROM platform.agent_run_events e
               WHERE e.run_id = r.run_id
                 AND e.tenant_id = r.tenant_id
             ),
             0
           ) AS total_cost_minor_units,
           COALESCE(
             (
               SELECT event_type
               FROM platform.agent_run_events e
               WHERE e.run_id = r.run_id
                 AND e.tenant_id = r.tenant_id
               ORDER BY e.sequence DESC LIMIT 1
             ),
             'STARTED'
           ) AS status,
           COALESCE(
             (
               SELECT occurred_at
               FROM platform.agent_run_events e
               WHERE e.run_id = r.run_id
                 AND e.tenant_id = r.tenant_id
               ORDER BY e.sequence DESC LIMIT 1
             ),
             r.created_at
           ) AS updated_at
         FROM platform.agent_runs r
         LEFT JOIN platform.agent_definitions a ON a.slug = r.agent_id
         LEFT JOIN platform.capabilities c ON c.capability_key = r.agent_id
         WHERE r.tenant_id = $1
         ORDER BY r.created_at DESC
         LIMIT 50`,
        [context.tenantId],
      ),
    );

    return NextResponse.json(result.rows, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
