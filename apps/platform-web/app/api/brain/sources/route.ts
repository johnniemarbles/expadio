import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { BrainSource } from '../../../../lib/brain-contracts';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../lib/iam-adapter';

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

    // Mock DB Query for sources (since specific schema is not provided yet)
    // const result = await dbPool.query('SELECT * FROM brain.sources WHERE tenant_id = $1', [effectiveContext.tenantId]);
    
    // For now returning simulated live data as requested
    const sources: BrainSource[] = [
      { id: 'src_live_a1', name: 'Live Corporate Policy Q3', kind: 'tenant-policy', precedence: 1, reviewStatus: 'approved', contentDigest: 'live-sha-999', effectiveDate: '2026-07-01T00:00:00Z', lastIndexed: new Date().toISOString(), classification: 'Confidential' },
      { id: 'src_live_a2', name: 'Live Regional Safety Code', kind: 'safety', precedence: 2, reviewStatus: 'pending', contentDigest: 'live-sha-888', effectiveDate: '2026-08-01T00:00:00Z', lastIndexed: new Date().toISOString(), classification: 'Public' }
    ];

    return NextResponse.json(sources);
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
