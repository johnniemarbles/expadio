import { NextResponse } from 'next/server';
import { dbPool } from '../../../../lib/iam-adapter';
import { deniedResponse, resolveRequestContext } from '../../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);

    // Query platform.intelligence_usage_events for usage summary grouping by meter column
    const result = await dbPool.query(
      `SELECT meter AS meter_kind, COUNT(*)::int as event_count, SUM(quantity)::bigint as total_quantity 
       FROM platform.intelligence_usage_events 
       WHERE tenant_id = $1 
       GROUP BY meter`,
      [effectiveContext.tenantId]
    );

    return NextResponse.json(result.rows);
  } catch (error: any) {
    console.error("Usage Summary API Error:", error);
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
