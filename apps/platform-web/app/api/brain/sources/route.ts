import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { BrainSource } from '../../../../lib/brain-contracts';
import type { DeniedResult } from '@expadio/ui/contracts';

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

  const sources: BrainSource[] = [
    { id: 'src_live_a1', name: 'Live Corporate Policy Q3', kind: 'tenant-policy', precedence: 1, reviewStatus: 'approved', contentDigest: 'live-sha-999', effectiveDate: '2026-07-01T00:00:00Z', lastIndexed: new Date().toISOString(), classification: 'Confidential' },
    { id: 'src_live_a2', name: 'Live Regional Safety Code', kind: 'safety', precedence: 2, reviewStatus: 'pending', contentDigest: 'live-sha-888', effectiveDate: '2026-08-01T00:00:00Z', lastIndexed: new Date().toISOString(), classification: 'Public' }
  ];

  return NextResponse.json(sources);
}
