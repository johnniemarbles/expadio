import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { loadTenantInstances } from '../../../../lib/governance-instances';

/**
 * The tenant-wide in-flight workflow view — every governed instance across all
 * verticals and the stage it sits at. A membership read; RLS keeps it within the
 * caller's tenant. `workType` filters to one process; `state` narrows to an exact
 * state (default: the open, non-terminal instances).
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
    return NextResponse.json({ instances });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
