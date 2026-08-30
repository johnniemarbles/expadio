import { NextResponse } from 'next/server';
import { deniedResponse, resolveRequestContext, withTenantClient } from '../../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);
    // Query latest AI job execution pipelines
    const rows = await withTenantClient(effectiveContext, async (client) => {
      const result = await client.query(
        `SELECT j.job_id, j.operation, j.purpose, j.created_at,
                (SELECT e.event_type FROM platform.ai_job_events e 
                 WHERE e.job_id = j.job_id AND e.tenant_id = j.tenant_id 
                 ORDER BY e.sequence DESC LIMIT 1) as status
         FROM platform.ai_jobs j
         WHERE j.tenant_id = $1
         ORDER BY j.created_at DESC LIMIT 20`,
        [effectiveContext.tenantId]
      );
      return result.rows;
    });

    const pipelines = rows.map((row: any) => ({
      id: row.job_id.split('-')[0], // Shorten ID for display
      name: row.purpose,
      status: row.status || 'STARTED',
      currentStage: row.operation,
      totalStages: 1
    }));

    return NextResponse.json(pipelines);
  } catch (error: any) {
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
