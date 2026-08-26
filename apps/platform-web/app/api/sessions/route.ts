import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../lib/iam-adapter';

export async function GET(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'UNAUTHENTICATED',
      message: 'User is not authenticated'
    };
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

    // Mock DB Query for sessions
    // const result = await dbPool.query('SELECT * FROM platform.sessions WHERE tenant_id = $1', [effectiveContext.tenantId]);

    return NextResponse.json({
      sessionId: `sess_live_${Date.now()}`,
      status: 'active'
    });
  } catch (error) {
    console.error("IAM Resolution Error:", error);
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'UNAUTHORIZED_OR_UNMAPPED',
      message: 'Could not resolve internal EXPADIO identity for this user.'
    };
    return NextResponse.json(denied, { status: 403 });
  }
}
