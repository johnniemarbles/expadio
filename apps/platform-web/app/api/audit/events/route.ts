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
    await resolve();
    // TODO: replace with real DB query to fetch audit events
    const events: any[] = [];
    return NextResponse.json(events);
  } catch (error: any) {
    const denied: DeniedResult = { denied: true, reasonKey: 'INTERNAL_ERROR', message: error.message || 'Unknown error' };
    return NextResponse.json(denied, { status: 500 });
  }
}
