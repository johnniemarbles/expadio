import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../lib/request-context';
import { loadPendingReviews } from '../../../../../lib/governance-pending-reviews';
import { toPendingReviewsCsv } from '../../../../../lib/governance-pending-csv';

/**
 * CSV export of the team-wide pending-review load. A membership read; RLS keeps
 * it within the caller's tenant. `workType` and `assignee` filters mirror the
 * JSON route so the download matches what is on screen.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const url = new URL(request.url);
    const workTypeKey = url.searchParams.get('workType')?.trim() ?? '';
    const assignee = url.searchParams.get('assignee')?.trim() ?? '';
    const items = await withTenantClient(context, (client) => loadPendingReviews(client, { workTypeKey, assignee }));
    const csv = toPendingReviewsCsv(items);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="pending-review-load.csv"',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
