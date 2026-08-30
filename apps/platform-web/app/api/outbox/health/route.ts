import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import {
  isOutboxHealthKey,
  listOutboxHealthSummary,
} from '../../../../lib/outbox-health-summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function singleParam(searchParams: URLSearchParams, key: string): string | undefined {
  const value = searchParams.get(key)?.trim();
  return value === undefined || value === null || value === '' ? undefined : value;
}

/**
 * Tenant-scoped transactional outbox health summary.
 *
 * This is a bounded read-only operations API over platform.outbox_health_summary.
 * It reports operational state only and never mutates outbox or execution data.
 */
export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const { searchParams } = new URL(request.url);
    const healthKey = singleParam(searchParams, 'healthKey');

    if (healthKey !== undefined && !isOutboxHealthKey(healthKey)) {
      return NextResponse.json(
        { error: 'Unsupported outbox health key.' },
        { status: 400 },
      );
    }

    const entries = await withTenantClient(context, async (client) => listOutboxHealthSummary(client, {
      tenantId: context.tenantId,
      ...(healthKey === undefined ? {} : { healthKey }),
    }));

    return NextResponse.json({ entries });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
