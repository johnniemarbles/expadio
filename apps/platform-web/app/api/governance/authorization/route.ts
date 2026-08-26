import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository } from '../../../../lib/iam-adapter';

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
    const mockTrace = {
      decision: 'DENIED',
      stages: [
        { name: 'TENANT', status: 'PASS', detail: 'Resource belongs to effective tenant' },
        { name: 'CAPABILITY', status: 'PASS', detail: 'Actor has assignment granting requested action' },
        { name: 'ENTITLEMENT', status: 'PASS', detail: 'Required entitlement flags are active' },
        { name: 'SCOPE', status: 'PASS', detail: 'In-scope for organization and operating unit' },
        { name: 'RESOURCE_STATE', status: 'PASS', detail: 'Resource is in allowed state' },
        { name: 'CLASSIFICATION', status: 'FAIL', detail: 'Actor clearance rank (internal) insufficient for data classification (sensitive)' },
        { name: 'RELATIONSHIP', status: 'SKIPPED', detail: 'No relationship markers required' },
        { name: 'RESTRICTION', status: 'SKIPPED', detail: 'No fine-grained restrictions' },
        { name: 'SOD', status: 'SKIPPED', detail: 'Segregation of Duties not evaluated (failed prior)' }
      ]
    };
    return NextResponse.json(mockTrace);
  } catch (error: any) {
    const denied: DeniedResult = { denied: true, reasonKey: 'INTERNAL_ERROR', message: error.message || 'Unknown error' };
    return NextResponse.json(denied, { status: 500 });
  }
}
