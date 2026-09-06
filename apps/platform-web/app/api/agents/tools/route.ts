import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { dbPool } from '../../../../lib/iam-adapter';
import { resolveRequestContext, deniedResponse } from '../../../../lib/request-context';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true }, { status: 401 });
  
  try {
    const effectiveContext = await resolveRequestContext(request);

    const result = await dbPool.query(
      `SELECT tool_group, enabled
         FROM platform.tenant_tool_grants
        WHERE tenant_id = $1`,
      [effectiveContext.tenantId]
    );
    
    return NextResponse.json(result.rows);
  } catch (err: any) {
    const resp = deniedResponse(err);
    return NextResponse.json(resp.body, { status: resp.status });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true }, { status: 401 });
  
  try {
    const effectiveContext = await resolveRequestContext(request);
    
    const { tool_group, enabled } = await request.json();
    if (!tool_group) return NextResponse.json({ error: 'tool_group required' }, { status: 400 });

    await dbPool.query(
      `INSERT INTO platform.tenant_tool_grants (tenant_id, tool_group, enabled, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tenant_id, tool_group) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
      [effectiveContext.tenantId, tool_group, enabled]
    );
    
    return NextResponse.json({ success: true, tool_group, enabled });
  } catch (err: any) {
    const resp = deniedResponse(err);
    return NextResponse.json(resp.body, { status: resp.status });
  }
}
