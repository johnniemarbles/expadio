import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../lib/request-context';
import { loadTenantInstances } from '../../../../../lib/governance-instances';
import { toInstancesCsv } from '../../../../../lib/governance-instances-csv';

/**
 * CSV export of the in-flight workflow view. A membership read; RLS keeps it
 * within the caller's tenant. `workType` and `state` filters mirror the JSON
 * route so the download matches what is on screen.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const url = new URL(request.url);
    const workTypeKey = url.searchParams.get('workType')?.trim() ?? '';
    const state = url.searchParams.get('state')?.trim() ?? '';
    const instances = await withTenantClient(context, (client) => loadTenantInstances(client, { workTypeKey, state }));
    const csv = toInstancesCsv(instances);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="in-flight-workflows.csv"',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
