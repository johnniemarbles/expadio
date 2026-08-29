import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { loadPendingReviews } from '../../../../lib/governance-pending-reviews';

/**
 * The team-wide pending-review load — every open governed instance waiting on a
 * named person to act, and on whom, across all verticals. A membership read;
 * RLS keeps it within the caller's tenant. `workType` filters to one process;
 * `assignee` narrows to one person's pending items.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const url = new URL(request.url);
    const workTypeKey = url.searchParams.get('workType')?.trim() ?? '';
    const assignee = url.searchParams.get('assignee')?.trim() ?? '';
    const items = await withTenantClient(context, (client) =>
      loadPendingReviews(client, { workTypeKey, assignee }),
    );
    return NextResponse.json({ items });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
