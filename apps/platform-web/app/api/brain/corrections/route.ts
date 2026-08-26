import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { CorrectionProposal } from '../../../../lib/brain-contracts';
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

  const corrections: CorrectionProposal[] = [
    { id: 'corr_live_100', title: 'Update Holiday Policy (Live)', category: 'tenant-policy', stage: 'reviewing', proposedBy: 'live_user_xyz', evidenceRefs: ['doc_991'], createdAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: new Date().toISOString() },
    { id: 'corr_live_101', title: 'Fix Typo in Priority Doc', category: 'priority', stage: 'routed', proposedBy: 'live_user_abc', evidenceRefs: [], createdAt: new Date(Date.now() - 3600000).toISOString(), updatedAt: new Date().toISOString() }
  ];

  return NextResponse.json(corrections);
}
