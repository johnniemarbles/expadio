import { NextResponse } from 'next/server';
import type { TraceOutcome } from '@expadio/communication';
import { PostgresDecisionTraceRepository } from '@expadio/postgres-runtime';
import { dbPool } from '../../../../lib/iam-adapter';
import { resolveRequestContext, deniedResponse } from '../../../../lib/request-context';

/**
 * Design spec §7.3 — where the trace is reachable.
 *
 * From a delivery row, from a refusal notification, from the simulator, from
 * an audit entry, and by correlation ID from a support ticket. All list
 * parameters sync to URL query params so state survives refresh and is
 * deep-linkable (§8).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const url = new URL(request.url);

    const repository = new PostgresDecisionTraceRepository(dbPool);
    const messageId = url.searchParams.get('messageId');
    const outcome = url.searchParams.get('outcome');
    const reasonCode = url.searchParams.get('reasonCode');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    const result = await repository.list({
      tenantId: context.tenantId,
      ...(messageId !== null ? { messageId } : {}),
      ...(outcome !== null ? { outcome: outcome as TraceOutcome } : {}),
      ...(reasonCode !== null ? { reasonCode } : {}),
      ...(from !== null ? { from } : {}),
      ...(to !== null ? { to } : {}),
      limit: Number(url.searchParams.get('limit') ?? 25),
      offset: Number(url.searchParams.get('offset') ?? 0),
    });

    return NextResponse.json(result);
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
