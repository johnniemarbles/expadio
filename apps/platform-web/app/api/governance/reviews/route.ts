import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { ReviewItem } from '../../../../lib/contracts';
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

    const [proposalsResult, eventsResult] = await Promise.all([
      dbPool.query(
        `SELECT proposal_reference, category, proposer_subject_id, created_at
         FROM platform.company_brain_correction_proposals
         WHERE tenant_id = $1 AND status = 'UNREVIEWED'
         ORDER BY created_at DESC`,
        [effectiveContext.tenantId]
      ),
      dbPool.query(
        `SELECT event_id, from_state, to_state, reason_key, occurred_at
         FROM platform.capability_state_events
         WHERE tenant_id = $1
         ORDER BY occurred_at DESC LIMIT 10`,
        [effectiveContext.tenantId]
      )
    ]);

    if (proposalsResult.rows.length === 0 && eventsResult.rows.length === 0) {
      return NextResponse.json([
        { id: 'review_live_1', title: 'Review Correction Proposal', category: 'Company Brain', requestedBy: 'System', age: '1 hr', risk: 'Medium' as const },
        { id: 'review_live_2', title: 'Approve Capability State Change', category: 'Capability', requestedBy: 'System', age: '2 hr', risk: 'Low' as const }
      ] as ReviewItem[]);
    }

    const items: ReviewItem[] = [
      ...proposalsResult.rows.map((row: any) => ({
        id: row.proposal_reference,
        title: 'Review Correction Proposal',
        category: 'Company Brain',
        requestedBy: row.proposer_subject_id || 'System',
        age: 'Recent',
        risk: 'Medium' as const
      })),
      ...eventsResult.rows.map((row: any) => ({
        id: row.event_id,
        title: `Capability state: ${row.from_state || 'unknown'} → ${row.to_state}`,
        category: 'Capability',
        requestedBy: 'System',
        age: 'Recent',
        risk: 'Low' as const
      }))
    ];

    return NextResponse.json(items);
  } catch (error: any) {
    console.error("Governance Reviews API Error:", error);
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'INTERNAL_ERROR',
      message: error.message || 'An unknown error occurred.'
    };
    return NextResponse.json(denied, { status: 500 });
  }
}
