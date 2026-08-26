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
    // Query platform.workflow_instances for active workflow instances
    const result = await dbPool.query(
      `SELECT instance_id, blueprint_id, current_stage_key, state, created_at, updated_at 
       FROM platform.workflow_instances 
       WHERE tenant_id = $1 
       ORDER BY created_at DESC LIMIT 50`,
      [effectiveContext.tenantId]
    );
    return NextResponse.json(result.rows);
  } catch (error: any) {
    console.error("Workflow Instances API Error:", error);
    const denied: DeniedResult = { denied: true, reasonKey: 'INTERNAL_ERROR', message: error.message || 'Unknown error' };
    return NextResponse.json(denied, { status: 500 });
  }
}
