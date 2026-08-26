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
    return NextResponse.json({ denied: true, reasonKey: 'INTERNAL_ERROR', message: err.message }, { status: 500 });
  }
}
