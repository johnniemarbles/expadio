import { NextResponse } from 'next/server';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../../../lib/request-context';
import { loadExecutionTraceForEvent } from '../../../../../lib/execution-trace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const eventId = decodeURIComponent((await params).eventId);

    const trace = await withTenantTransaction(context, (client) =>
      loadExecutionTraceForEvent(client, {
        tenantId: context.tenantId,
        eventId,
      }),
    );

    if (trace === null) {
      return NextResponse.json(
        { error: 'Execution trace event was not found.' },
        { status: 404 },
      );
    }

    return NextResponse.json(trace);
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
