import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../lib/iam-adapter';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    const denied: DeniedResult = { denied: true, reasonKey: 'UNAUTHENTICATED', message: 'User is not authenticated' };
    return NextResponse.json(denied, { status: 401 });
  }
  const resolve = () =>
    authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
    );
  try {
    const effectiveContext = await resolve();
    // Query platform.agent_runs for run history
    const result = await dbPool.query(
      `SELECT session_id, status, created_at, updated_at 
       FROM platform.agent_runs 
       WHERE tenant_id = $1 
       ORDER BY created_at DESC LIMIT 50`,
      [effectiveContext.tenantId]
    );
    return NextResponse.json(result.rows);
  } catch (error: any) {
    console.error("Agent Runs API Error:", error);
    const denied: DeniedResult = { denied: true, reasonKey: 'INTERNAL_ERROR', message: error.message || 'Unknown error' };
    return NextResponse.json(denied, { status: 500 });
  }
}
