import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../lib/request-context';
import { loadTenantDecisions } from '../../../../../lib/governance-decisions';
import { toDecisionsCsv } from '../../../../../lib/governance-decisions-csv';

/**
 * Compliance export of the governed-decision log as CSV. A membership read; RLS
 * keeps it within the caller's tenant. Optional `workType` filter narrows to one
 * process, mirroring the JSON log route so the download matches what is on
 * screen.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const workTypeKey = new URL(request.url).searchParams.get('workType')?.trim() ?? '';
    const decisions = await withTenantClient(context, (client) => loadTenantDecisions(client, { workTypeKey }));
    const csv = toDecisionsCsv(decisions);
    const suffix = workTypeKey ? `-${workTypeKey}` : '';
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="governed-decisions${suffix}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
