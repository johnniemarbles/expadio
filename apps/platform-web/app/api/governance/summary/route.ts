import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { loadGovernanceSummary } from '../../../../lib/governance-summary';

/**
 * At-a-glance governed-activity counts for the tenant — open workflows by work
 * type and recorded decisions by outcome. A membership read; RLS-scoped.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const summary = await withTenantClient(context, (client) => loadGovernanceSummary(client));
    return NextResponse.json(summary);
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
