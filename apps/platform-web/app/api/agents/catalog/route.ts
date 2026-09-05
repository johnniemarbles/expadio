import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../lib/iam-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true, reasonKey: 'UNAUTHENTICATED' }, { status: 401 });

  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
    );

    const result = await dbPool.query(
      `SELECT c.capability_id, c.capability_key, c.display_name, c.department,
              c.description, c.permitted_modes, c.enabled,
              b.binding_id,
              COALESCE(s.state, 'NOT_CONFIGURED') AS bound_status
         FROM platform.capabilities c
         LEFT JOIN platform.tenant_capability_bindings b
           ON b.capability_id = c.capability_id AND b.tenant_id = $1
         LEFT JOIN platform.capability_state s ON s.binding_id = b.binding_id
        WHERE c.enabled = true
        ORDER BY c.department, c.display_name`,
      [effectiveContext.tenantId]
    );

    return NextResponse.json(result.rows, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
