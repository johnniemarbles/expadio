import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { loadDecisionCycleTime } from '../../../../lib/governance-cycle-time';

/**
 * Per-vertical time-to-decision (cycle time) — how long instances sit on a stage
 * before it is decided. A membership read; RLS keeps it within the caller's
 * tenant.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const cycleTime = await withTenantClient(context, (client) => loadDecisionCycleTime(client));
    return NextResponse.json({ cycleTime });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
