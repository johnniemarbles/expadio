import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository } from '../../../lib/iam-adapter';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    const denied: DeniedResult = { denied: true, reasonKey: 'UNAUTHENTICATED', message: 'User is not authenticated' };
    return NextResponse.json(denied, { status: 401 });
  }
  const resolve = () => authenticateAndResolveContext(
    { identityVerifier, membershipRepository },
    { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
  );
  try {
    await resolve();
    const mockConfig = {
      scopes: ['Platform', 'Vertical', 'Tenant'],
      activeSettings: [
        { key: 'retention.knowledge.max_days', value: '365', scope: 'Tenant', overridden: true },
        { key: 'ai.safety.toxicity_threshold', value: '0.85', scope: 'Platform', overridden: false },
        { key: 'workflow.approval.require_dual_control', value: 'true', scope: 'Vertical', overridden: false }
      ]
    };
    return NextResponse.json(mockConfig);
  } catch (error: any) {
    const denied: DeniedResult = { denied: true, reasonKey: 'INTERNAL_ERROR', message: error.message || 'Unknown error' };
    return NextResponse.json(denied, { status: 500 });
  }
}
