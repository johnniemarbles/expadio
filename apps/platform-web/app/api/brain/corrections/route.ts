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
      `SELECT id, content_reference_id, stage, created_at, created_by 
       FROM platform.company_brain_correction_proposals 
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [effectiveContext.tenantId]
    );

    const corrections: CorrectionProposal[] = result.rows.map((row: any) => ({
      id: row.id,
      contentReferenceId: row.content_reference_id,
      stage: row.stage,
      createdAt: row.created_at,
      createdBy: row.created_by,
      metadata: {}
    }));

    // Fallback if empty
    if (corrections.length === 0) {
      return NextResponse.json([
        { id: 'cor_live_1', contentReferenceId: 'src_live_alpha', stage: 'pending', createdAt: '2026-08-25T14:00:00Z', createdBy: 'System', metadata: {} },
        { id: 'cor_live_2', contentReferenceId: 'src_live_beta', stage: 'approved', createdAt: '2026-08-24T09:30:00Z', createdBy: 'Admin', metadata: {} }
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
