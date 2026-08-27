import { NextResponse } from 'next/server';
import { PostgresDecisionTraceRepository } from '@expadio/postgres-runtime';
import { dbPool } from '../../../../../lib/iam-adapter';
import { resolveRequestContext, deniedResponse } from '../../../../../lib/request-context';

/**
 * Design spec §7 — a single trace.
 *
 * Note what is NOT here: any un-redacted recipient identifier. Redaction runs
 * in @expadio/communication's `redactRecipient`, applied when the gate record
 * is built, so there is one predicate and one test rather than a serialiser
 * that has to remember (§3.4, export redaction).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ traceId: string }> },
) {
  try {
    const context = await resolveRequestContext();
    const traceId = decodeURIComponent((await params).traceId);

    const repository = new PostgresDecisionTraceRepository(dbPool);
    const trace = await repository.findById({ tenantId: context.tenantId, traceId });

    if (trace === null) {
      return NextResponse.json({ error: 'That trace was not found.' }, { status: 404 });
    }
    return NextResponse.json(trace);
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
