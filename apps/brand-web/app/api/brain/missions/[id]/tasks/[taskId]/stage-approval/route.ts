import { NextResponse } from 'next/server';
import { resolveBrandContext, withBrandTransaction } from '@/lib/brand-context';
import {
  stageCommitteeOutputForApproval,
  CommitteeApprovalStagingError,
} from '@expadio/postgres-runtime/committee-approval-staging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stages a completed committee task's actual output (not its input payload)
 * as a real approval request, routed to the right entity node's authority
 * via routeApprovalTarget() (Phase 4). This is the connecting piece between
 * the OBSERVE-effect committee tools (editorial/revenue/voice, Phases 3/5/6)
 * -- which run and complete without ever entering the approval queue -- and
 * the Decision Fabric approval screen this brand workspace already has
 * (../../page.tsx), which renders whatever is in agent_approval_requests
 * with no changes needed on its side.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  try {
    const context = await resolveBrandContext();
    const { taskId } = await params;

    const result = await withBrandTransaction(context, (client) =>
      stageCommitteeOutputForApproval(client, {
        tenantId: context.tenantId,
        taskId,
        organizationId: context.organizationId,
        proposerSubjectId: context.subjectId,
      }),
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof CommitteeApprovalStagingError) {
      return NextResponse.json({ error: err.code }, { status: 409 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
