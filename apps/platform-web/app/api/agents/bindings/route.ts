import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { dbPool } from '../../../../lib/iam-adapter';
import { resolveRequestContext, deniedResponse } from '../../../../lib/request-context';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true, reasonKey: 'UNAUTHENTICATED' }, { status: 401 });
  
  try {
    const effectiveContext = await resolveRequestContext(request);

    const result = await dbPool.query(
      `SELECT b.binding_id, a.slug as capability_key, a.persona as display_name, a.department, a.persona as description,
              'A' as mapped_to_resource, COALESCE(b.status, 'NOT_CONFIGURED') as status, b.created_at
         FROM platform.tenant_agent_bindings b
         JOIN platform.agent_definitions a ON b.agent_id = a.agent_id
        WHERE b.tenant_id = $1
        ORDER BY a.department, a.persona`,
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
    
    const { capability_key } = await request.json();
    if (!capability_key) return NextResponse.json({ error: 'capability_key required' }, { status: 400 });

    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      const capRes = await client.query('SELECT agent_id FROM platform.agent_definitions WHERE slug = $1', [capability_key]);
      if (capRes.rowCount === 0) throw new Error('Agent not found');
      
      const res = await client.query(
        `INSERT INTO platform.tenant_agent_bindings (tenant_id, agent_id, status, bound_by, bound_at, created_at, updated_at)
         VALUES ($1, $2, 'ACTIVE', $3, NOW(), NOW(), NOW())
         ON CONFLICT (tenant_id, agent_id) DO UPDATE SET status = 'ACTIVE'
         RETURNING binding_id`,
        [effectiveContext.tenantId, capRes.rows[0].agent_id, userId]
      );
      
      const bindingId = res.rows[0].binding_id;
      
      await client.query('COMMIT');
      return NextResponse.json({ success: true, binding_id: bindingId });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    const resp = deniedResponse(err);
    return NextResponse.json(resp.body, { status: resp.status });
  }
}

export async function PATCH(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true }, { status: 401 });

  try {
    const effectiveContext = await resolveRequestContext(request);

    const { binding_id, action } = await request.json();
    if (!binding_id || !action) return NextResponse.json({ error: 'binding_id and action required' }, { status: 400 });

    const state = action === 'activate' ? 'ACTIVE' : action === 'suspend' ? 'SUSPENDED' : null;
    if (!state) return NextResponse.json({ error: 'action must be activate or suspend' }, { status: 400 });

    await dbPool.query(
      `UPDATE platform.tenant_agent_bindings
          SET status = $1, updated_at = NOW()
        WHERE binding_id = $2 AND tenant_id = $3`,
      [state, binding_id, effectiveContext.tenantId]
    );

    return NextResponse.json({ success: true, state });
  } catch (err: any) {
    const resp = deniedResponse(err);
    return NextResponse.json(resp.body, { status: resp.status });
  }
}

export async function DELETE(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true }, { status: 401 });
  
  try {
    const effectiveContext = await resolveRequestContext(request);
    
    const url = new URL(request.url);
    const binding_id = url.searchParams.get('id');
    if (!binding_id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

    await dbPool.query(
      'DELETE FROM platform.tenant_agent_bindings WHERE binding_id = $1 AND tenant_id = $2',
      [binding_id, effectiveContext.tenantId]
    );

    return NextResponse.json({ success: true });
  } catch (err: any) {
    const resp = deniedResponse(err);
    return NextResponse.json(resp.body, { status: resp.status });
  }
}
