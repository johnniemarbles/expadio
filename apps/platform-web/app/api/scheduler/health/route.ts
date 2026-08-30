import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import {
  isSchedulerHealthKey,
  listSchedulerHealthSummary,
} from '../../../../lib/scheduler-health-summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function singleParam(searchParams: URLSearchParams, key: string): string | undefined {
  const value = searchParams.get(key)?.trim();
  return value === undefined || value === null || value === '' ? undefined : value;
}

/**
 * Tenant-scoped scheduler health summary.
 *
 * This is a bounded read-only operations API over platform.scheduler_health_summary.
 * It reports operational state only and never mutates scheduler or execution data.
 */
export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const { searchParams } = new URL(request.url);
    const healthKey = singleParam(searchParams, 'healthKey');

    if (healthKey !== undefined && !isSchedulerHealthKey(healthKey)) {
      return NextResponse.json(
        { error: 'Unsupported scheduler health key.' },
        { status: 400 },
      );
    }

    const entries = await withTenantClient(context, async (client) => listSchedulerHealthSummary(client, {
      tenantId: context.tenantId,
      ...(healthKey === undefined ? {} : { healthKey }),
    }));

    return NextResponse.json({ entries });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
