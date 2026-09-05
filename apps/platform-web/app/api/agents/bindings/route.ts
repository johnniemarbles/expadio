import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../lib/iam-adapter';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true, reasonKey: 'UNAUTHENTICATED' }, { status: 401 });
  
  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
    );

    const result = await dbPool.query(
      `SELECT b.binding_id, c.capability_key, c.display_name, c.department, c.description,
              b.mode as mapped_to_resource, COALESCE(s.state, 'NOT_CONFIGURED') as status, b.created_at
         FROM platform.tenant_capability_bindings b
         JOIN platform.capabilities c ON b.capability_id = c.capability_id
         LEFT JOIN platform.capability_state s ON b.binding_id = s.binding_id
        WHERE b.tenant_id = $1
        ORDER BY c.department, c.display_name`,
      [effectiveContext.tenantId]
    );
    
    return NextResponse.json(result.rows);
  } catch (err: any) {
    return NextResponse.json({ denied: true, reasonKey: 'INTERNAL_ERROR', message: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true }, { status: 401 });
  
  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
    );
    
    const { capability_key, mode = 'A' } = await request.json();
    if (!capability_key) return NextResponse.json({ error: 'capability_key required' }, { status: 400 });

    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      const capRes = await client.query('SELECT capability_id FROM platform.capabilities WHERE capability_key = $1', [capability_key]);
      if (capRes.rowCount === 0) throw new Error('Capability not found');
      
      const res = await client.query(
        `INSERT INTO platform.tenant_capability_bindings (tenant_id, capability_id, mode, is_entitled, created_at, updated_at)
         VALUES ($1, $2, $3, true, NOW(), NOW())
         RETURNING binding_id`,
        [effectiveContext.tenantId, capRes.rows[0].capability_id, mode]
      );
      
      await client.query('COMMIT');
      return NextResponse.json({ success: true, binding_id: res.rows[0].binding_id });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    return NextResponse.json({ denied: true, reasonKey: 'INTERNAL_ERROR', message: err.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true }, { status: 401 });

  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
    );

    const { binding_id, action } = await request.json();
    if (!binding_id || !action) return NextResponse.json({ error: 'binding_id and action required' }, { status: 400 });

    const state = action === 'activate' ? 'ACTIVE' : action === 'suspend' ? 'SUSPENDED' : null;
    if (!state) return NextResponse.json({ error: 'action must be activate or suspend' }, { status: 400 });

    await dbPool.query(
      `INSERT INTO platform.capability_state
         (binding_id, tenant_id, state, input_hash, version, resolved_at)
       SELECT $1, b.tenant_id, $2,
              encode(digest($1::text || $2, 'sha256'), 'hex'),
              1, NOW()
         FROM platform.tenant_capability_bindings b
        WHERE b.binding_id = $1 AND b.tenant_id = $3
       ON CONFLICT (binding_id) DO UPDATE SET
         state       = EXCLUDED.state,
         input_hash  = encode(digest($1::text || $2, 'sha256'), 'hex'),
         version     = platform.capability_state.version + 1,
         resolved_at = NOW()`,
      [binding_id, state, effectiveContext.tenantId]
    );

    return NextResponse.json({ success: true, state });
  } catch (err: any) {
    return NextResponse.json({ denied: true, reasonKey: 'INTERNAL_ERROR', message: err.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true }, { status: 401 });
  
  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
    );
    
    const url = new URL(request.url);
    const binding_id = url.searchParams.get('id');
    if (!binding_id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

    await dbPool.query(
      'DELETE FROM platform.tenant_capability_bindings WHERE binding_id = $1 AND tenant_id = $2',
      [binding_id, effectiveContext.tenantId]
    );

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ denied: true, reasonKey: 'INTERNAL_ERROR', message: err.message }, { status: 500 });
  }
}
