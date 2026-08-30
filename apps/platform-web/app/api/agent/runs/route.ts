import { NextResponse } from 'next/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { deniedResponse, resolveRequestContext, withTenantClient } from '../../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);

    const result = await withTenantClient(effectiveContext, (client) =>
      client.query(
        `SELECT 
           r.run_id AS session_id,
           r.created_at,
           COALESCE(
             (
               SELECT event_type 
               FROM platform.agent_run_events e 
               WHERE e.run_id = r.run_id AND e.tenant_id = r.tenant_id 
               ORDER BY e.sequence DESC LIMIT 1
             ), 
             'STARTED'
           ) AS status,
           COALESCE(
             (
               SELECT occurred_at 
               FROM platform.agent_run_events e 
               WHERE e.run_id = r.run_id AND e.tenant_id = r.tenant_id 
               ORDER BY e.sequence DESC LIMIT 1
             ), 
             r.created_at
           ) AS updated_at
         FROM platform.agent_runs r
         WHERE r.tenant_id = $1
         ORDER BY r.created_at DESC LIMIT 50`,
        [effectiveContext.tenantId]
      )
    );

    return NextResponse.json(result.rows);
  } catch (error: any) {
    console.error("Agent Runs API Error:", error);
    const denied = deniedResponse(error);
    if (denied.status !== 500) {
      return NextResponse.json(denied.body, { status: denied.status });
    }
    const body: DeniedResult = {
      denied: true,
      reasonKey: 'INTERNAL_ERROR',
      message: error.message || 'An unknown error occurred.'
    };
    return NextResponse.json(body, { status: 500 });
  }
}
