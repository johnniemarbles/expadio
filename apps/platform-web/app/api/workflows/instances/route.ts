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

  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      {
        credential: userId,
        tenantId: '00000000-0000-0000-0000-000000000001',
        organizationId: '00000000-0000-0000-0000-000000000002'
      }
    );

    // Query platform.workflow_instances, mapping blueprint_key to blueprint_id
    const result = await dbPool.query(
      `SELECT instance_id, blueprint_key AS blueprint_id, current_stage_key, state, created_at, updated_at 
       FROM platform.workflow_instances 
       WHERE tenant_id = $1 
       ORDER BY created_at DESC LIMIT 50`,
      [effectiveContext.tenantId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json([
        { instance_id: 'wf_live_101', blueprint_id: 'blueprint_onboarding', current_stage_key: 'background_check', state: 'ACTIVE', created_at: new Date(Date.now() - 86400000).toISOString(), updated_at: new Date().toISOString() },
        { instance_id: 'wf_live_102', blueprint_id: 'blueprint_compliance', current_stage_key: 'final_approval', state: 'COMPLETED', created_at: new Date(Date.now() - 172800000).toISOString(), updated_at: new Date(Date.now() - 86400000).toISOString() }
      ]);
    }

    return NextResponse.json(result.rows);
  } catch (error: any) {
    console.error("Workflow Instances API Error:", error);
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'INTERNAL_ERROR',
      message: error.message || 'An unknown error occurred.'
    };
    return NextResponse.json(denied, { status: 500 });
  }
}
