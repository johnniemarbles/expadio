import { NextResponse } from 'next/server';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../../lib/request-context';
import {
  DOMAIN_EVENT_OPERATION_STATUSES,
  loadDomainEventOperationCounts,
  loadDomainEventOperations,
  type DomainEventOperationStatus,
} from '../../../../lib/domain-event-operations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseStatus(value: string | null): DomainEventOperationStatus | undefined {
  if (value === null || value.trim() === '') return undefined;
  const normalized = value.trim().toUpperCase();
  if (!(DOMAIN_EVENT_OPERATION_STATUSES as readonly string[]).includes(normalized)) {
    throw Object.assign(new Error('DOMAIN_EVENT_STATUS_INVALID'), { status: 400 });
  }
  return normalized as DomainEventOperationStatus;
}

function parseLimit(value: string | null): number {
  if (value === null || value.trim() === '') return 100;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw Object.assign(new Error('DOMAIN_EVENT_LIMIT_INVALID'), { status: 400 });
  }
  return Math.min(parsed, 200);
}

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const url = new URL(request.url);
    const status = parseStatus(url.searchParams.get('status'));
    const limit = parseLimit(url.searchParams.get('limit'));

    const { items, counts } = await withTenantTransaction(context, async (client) => {
      const [items, counts] = await Promise.all([
        loadDomainEventOperations(client, {
          ...(status === undefined ? {} : { status }),
          limit,
        }),
        loadDomainEventOperationCounts(client),
      ]);
      return { items, counts };
    });

    return NextResponse.json({ items, counts });
  } catch (error) {
    const known = error as Error & { status?: number };
    if (known.message === 'DOMAIN_EVENT_STATUS_INVALID') {
      return NextResponse.json(
        { error: 'That Domain Event outbox status is not supported.' },
        { status: 400 },
      );
    }
    if (known.message === 'DOMAIN_EVENT_LIMIT_INVALID') {
      return NextResponse.json(
        { error: 'limit must be a positive integer.' },
        { status: 400 },
      );
    }
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
