import { NextResponse } from 'next/server';
import { dbPool } from '../../../../lib/iam-adapter';
import { deniedResponse, resolveRequestContext } from '../../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);

    // Query platform.workflow_instances, mapping blueprint_key to blueprint_id
    const result = await dbPool.query(
      `SELECT instance_id, blueprint_key AS blueprint_id, current_stage_key, state, created_at, updated_at 
       FROM platform.workflow_instances 
       WHERE tenant_id = $1 
       ORDER BY created_at DESC LIMIT 50`,
      [effectiveContext.tenantId]
    );

    return NextResponse.json(result.rows);
  } catch (error: any) {
    console.error("Workflow Instances API Error:", error);
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
