import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { loadTenantDecisions } from '../../../../lib/governance-decisions';

/**
 * The tenant-wide governed-decision log — every immutable stage decision across
 * all verticals, newest first. A membership read; RLS keeps it within the
 * caller's tenant. Optional `workType` filter narrows to one process.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const workTypeKey = new URL(request.url).searchParams.get('workType')?.trim() ?? '';
    const decisions = await withTenantClient(context, (client) => loadTenantDecisions(client, { workTypeKey }));
    return NextResponse.json({ decisions });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
