import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { loadReviewQueue } from '../../../../lib/governance-review-queue';

/**
 * The caller's cross-vertical review queue — every open governed instance
 * waiting on the authenticated participant to act, across all verticals. A
 * membership read; RLS keeps it within the caller's tenant, and it is scoped to
 * the caller's own subject id (your queue, not anyone else's).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const items = await withTenantClient(context, (client) =>
      loadReviewQueue(client, { subjectId: context.subjectId }),
    );
    return NextResponse.json({ items });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
