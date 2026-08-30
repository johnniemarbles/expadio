import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../lib/request-context';
import { listBusinessExecutionTrace } from '../../../lib/business-execution-trace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function singleParam(searchParams: URLSearchParams, key: string): string | undefined {
  const value = searchParams.get(key)?.trim();
  return value === undefined || value === null || value === '' ? undefined : value;
}

function parseLimit(searchParams: URLSearchParams): number {
  const raw = singleParam(searchParams, 'limit');
  if (raw === undefined) return 100;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(Math.max(parsed, 1), 200);
}

/**
 * Tenant-scoped business execution trace.
 *
 * Supported query shapes:
 * - ?eventId=<uuid>
 * - ?correlationId=<id>
 * - ?aggregateType=<type>&aggregateId=<id>
 *
 * At least one bounded business filter is required so this never becomes a
 * broad tenant table scan. RLS is bound through withTenantClient before reading
 * platform.business_execution_trace.
 */
export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const { searchParams } = new URL(request.url);

    const rootEventId = singleParam(searchParams, 'eventId');
    const correlationId = singleParam(searchParams, 'correlationId');
    const aggregateType = singleParam(searchParams, 'aggregateType');
    const aggregateId = singleParam(searchParams, 'aggregateId');

    const hasAggregateFilter = aggregateType !== undefined && aggregateId !== undefined;
    if (rootEventId === undefined && correlationId === undefined && !hasAggregateFilter) {
      return NextResponse.json(
        {
          error: 'Provide eventId, correlationId, or aggregateType + aggregateId to load an execution trace.',
        },
        { status: 400 },
      );
    }

    if ((aggregateType === undefined) !== (aggregateId === undefined)) {
      return NextResponse.json(
        { error: 'aggregateType and aggregateId must be supplied together.' },
        { status: 400 },
      );
    }

    const entries = await withTenantClient(context, async (client) => listBusinessExecutionTrace(client, {
      tenantId: context.tenantId,
      ...(rootEventId === undefined ? {} : { rootEventId }),
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(aggregateType === undefined ? {} : { aggregateType }),
      ...(aggregateId === undefined ? {} : { aggregateId }),
      limit: parseLimit(searchParams),
    }));

    return NextResponse.json({ entries });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
