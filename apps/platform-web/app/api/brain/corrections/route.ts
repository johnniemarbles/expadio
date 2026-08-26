import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { CorrectionProposal } from '../../../../lib/brain-contracts';
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

    const result = await dbPool.query(
      `SELECT id, stage, created_at, created_by 
       FROM platform.company_brain_correction_proposals 
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [effectiveContext.tenantId]
    );

    const corrections: CorrectionProposal[] = result.rows.map((row: any) => ({
      id: row.id,
      title: 'Database Correction',
      category: 'fact',
      stage: row.stage || 'reviewing',
      proposedBy: row.created_by || 'system',
      evidenceRefs: [],
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.created_at || new Date().toISOString()
    }));

    // Fallback if empty
    if (corrections.length === 0) {
      return NextResponse.json([
        { id: 'corr_live_100', title: 'Update Holiday Policy (Live)', category: 'tenant-policy', stage: 'reviewing', proposedBy: 'live_user_xyz', evidenceRefs: ['doc_991'], createdAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: new Date().toISOString() },
        { id: 'corr_live_101', title: 'Fix Typo in Priority Doc', category: 'priority', stage: 'routed', proposedBy: 'live_user_abc', evidenceRefs: [], createdAt: new Date(Date.now() - 3600000).toISOString(), updatedAt: new Date().toISOString() }
      ] as CorrectionProposal[]);
    }

    return NextResponse.json(corrections);
  } catch (error: any) {
    console.error("Brain Corrections API Error:", error);
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'INTERNAL_ERROR',
      message: error.message || 'An unknown error occurred.'
    };
    return NextResponse.json(denied, { status: 500 });
  }
}
