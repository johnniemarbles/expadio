import { NextResponse } from 'next/server';
import { dbPool } from '../../../../lib/iam-adapter';
import { deniedResponse, resolveRequestContext } from '../../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);

    const result = await dbPool.query(
      `SELECT o.organization_id, o.name, o.status, o.created_at, COUNT(m.membership_id)::int as members
       FROM platform.organizations o
       LEFT JOIN platform.memberships m ON o.organization_id = m.organization_id
       WHERE o.tenant_id = $1
       GROUP BY o.organization_id, o.name, o.status, o.created_at
       ORDER BY o.name ASC`,
      [effectiveContext.tenantId]
    );
    
    return NextResponse.json(result.rows);
  } catch (err: any) {
    const denied = deniedResponse(err);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}

export async function POST(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);
    
    const { name, kind = 'BUSINESS' } = await request.json();
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

    const result = await dbPool.query(
      `INSERT INTO platform.organizations (tenant_id, organization_kind, name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', NOW(), NOW())
       RETURNING organization_id, name, status`,
      [effectiveContext.tenantId, kind, name]
    );

    return NextResponse.json({ success: true, organization: result.rows[0] });
  } catch (err: any) {
    const denied = deniedResponse(err);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
