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
           COALESCE(
             (
               SELECT event_type
               FROM platform.agent_run_events e
               WHERE e.run_id = r.run_id
                 AND e.tenant_id = r.tenant_id
                 AND e.organization_id = r.organization_id
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
                 AND e.organization_id = r.organization_id
               ORDER BY e.sequence DESC LIMIT 1
             ),
             r.created_at
           ) AS updated_at
         FROM platform.agent_runs r
         WHERE r.tenant_id = $1
           AND r.organization_id = $2
         ORDER BY r.created_at DESC
         LIMIT 50`,
        [context.tenantId, context.organizationId],
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
