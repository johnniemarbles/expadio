import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { loadDecisionAnalytics } from '../../../../lib/governance-analytics';

/**
 * Per-vertical decision analytics — decision volume and approval rate for each
 * work type. A membership read; RLS keeps it within the caller's tenant.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const stats = await withTenantClient(context, (client) => loadDecisionAnalytics(client));
    return NextResponse.json({ stats });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
