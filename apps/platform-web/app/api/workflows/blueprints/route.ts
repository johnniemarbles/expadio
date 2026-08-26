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
      `SELECT blueprint_key, label as display_name, version, state as status, created_at
       FROM platform.workflow_blueprints
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
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
    
    const { blueprint_key, label, version = 1, stages = [] } = await request.json();
    if (!blueprint_key || !label) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });

    const result = await dbPool.query(
      `INSERT INTO platform.workflow_blueprints (tenant_id, blueprint_key, version, label, work_type_key, source, state, stages, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'DEFAULT_WORK', 'TENANT_CUSTOMIZED', 'DRAFT', $5, NOW(), NOW())
       RETURNING blueprint_key`,
      [effectiveContext.tenantId, blueprint_key, version, label, JSON.stringify(stages)]
    );

    return NextResponse.json({ success: true, blueprint_key: result.rows[0].blueprint_key });
  } catch (err: any) {
    return NextResponse.json({ denied: true, reasonKey: 'INTERNAL_ERROR', message: err.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true }, { status: 401 });
  
  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
    );
    
    const { blueprint_key, state } = await request.json();
    if (!blueprint_key || !state) return NextResponse.json({ error: 'Missing key or state' }, { status: 400 });

    const result = await dbPool.query(
      `UPDATE platform.workflow_blueprints SET state = $1, updated_at = NOW()
       WHERE blueprint_key = $2 AND tenant_id = $3
       RETURNING blueprint_key, state`,
      [state, blueprint_key, effectiveContext.tenantId]
    );

    if (result.rowCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, blueprint: result.rows[0] });
  } catch (err: any) {
    return NextResponse.json({ denied: true, reasonKey: 'INTERNAL_ERROR', message: err.message }, { status: 500 });
  }
}
