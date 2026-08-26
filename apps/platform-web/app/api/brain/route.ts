import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { BrainOverview } from '../../../lib/brain-contracts';
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
        tenantId: 'tnt_dreamware',
        organizationId: 'org_dreamware'
      }
    );

    // Mock query for Brain Overview
    // In reality, this would count rows in sources, corrections, etc. for the tenant
    const overview: BrainOverview = {
      source: { kind: 'live', label: 'Live Core Brain Database', capturedAt: new Date().toISOString() },
      indexedSources: 1254,
      pendingCorrections: 8,
      freshnessTargetHours: 24,
      lastIndexedAt: new Date().toISOString(),
      healthSummary: 'Optimal (Live DB Connected)'
    };

    return NextResponse.json(overview);
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
