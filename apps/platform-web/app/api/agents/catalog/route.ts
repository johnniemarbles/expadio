import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { dbPool } from '../../../../lib/iam-adapter';
import { resolveRequestContext, deniedResponse } from '../../../../lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true, reasonKey: 'UNAUTHENTICATED' }, { status: 401 });

  try {
    const effectiveContext = await resolveRequestContext(request);

    const result = await dbPool.query(
      `SELECT a.agent_id as capability_id, a.slug as capability_key, a.persona as display_name, a.department,
              a.persona as description, '[]'::jsonb as permitted_modes, true as enabled,
              b.binding_id,
              COALESCE(b.status, 'NOT_CONFIGURED') AS bound_status
         FROM platform.agent_definitions a
         LEFT JOIN platform.tenant_agent_bindings b
           ON b.agent_id = a.agent_id AND b.tenant_id = $1
        ORDER BY a.department, a.persona`,
      [effectiveContext.tenantId]
    );

    return NextResponse.json(result.rows, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err: any) {
    const resp = deniedResponse(err);
    return NextResponse.json(resp.body, { status: resp.status });
  }
}
