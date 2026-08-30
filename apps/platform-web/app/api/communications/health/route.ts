import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import {
  isCommunicationHealthKey,
  listCommunicationHealthSummary,
} from '../../../../lib/communication-health-summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function singleParam(searchParams: URLSearchParams, key: string): string | undefined {
  const value = searchParams.get(key)?.trim();
  return value === undefined || value === null || value === '' ? undefined : value;
}

/**
 * Tenant-scoped communication health summary.
 *
 * This is a bounded read-only operations API over platform.communication_health_summary.
 * It reports operational state only and never mutates communication data.
 */
export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const { searchParams } = new URL(request.url);
    const healthKey = singleParam(searchParams, 'healthKey');

    if (healthKey !== undefined && !isCommunicationHealthKey(healthKey)) {
      return NextResponse.json(
        { error: 'Unsupported communication health key.' },
        { status: 400 },
      );
    }

    const entries = await withTenantClient(context, async (client) => listCommunicationHealthSummary(client, {
      tenantId: context.tenantId,
      ...(healthKey === undefined ? {} : { healthKey }),
    }));

    return NextResponse.json({ entries });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
