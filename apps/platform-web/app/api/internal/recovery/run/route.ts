import { NextResponse } from 'next/server';
import { dbPool } from '../../../../../lib/iam-adapter';
import {
  InternalWorkerAuthError,
  authenticateInternalWorkerRequest,
} from '../../../../../lib/internal-worker-auth';
import {
  runGovernedRecoveryWorkerBatch,
} from '../../../../../lib/governed-recovery-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function parseLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new InternalWorkerAuthError(
      400,
      'INTERNAL_WORKER_LIMIT_INVALID',
      'limit must be a positive integer.',
    );
  }
  return Math.min(value as number, MAX_LIMIT);
}

export async function POST(request: Request) {
  let client: import('pg').PoolClient | null = null;
  let tenantBound = false;

  try {
    const { tenantId } = authenticateInternalWorkerRequest(request);

    let body: unknown = {};
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        body = await request.json();
      } catch {
        throw new InternalWorkerAuthError(
          400,
          'INTERNAL_WORKER_BODY_INVALID',
          'Request body must be valid JSON.',
        );
      }
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new InternalWorkerAuthError(
        400,
        'INTERNAL_WORKER_BODY_INVALID',
        'Request body must be a JSON object.',
      );
    }

    const limit = parseLimit((body as Record<string, unknown>).limit);
    client = await dbPool.connect();

    await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);
    tenantBound = true;

    const summary = await runGovernedRecoveryWorkerBatch(client, {
      tenantId,
      workerSubjectId: 'expadio-recovery-worker',
      limit,
    });

    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    if (error instanceof InternalWorkerAuthError) {
      return NextResponse.json(
        { ok: false, error: error.message, reasonCode: error.reasonCode },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: 'Internal governed recovery worker execution failed.',
        reasonCode: 'INTERNAL_RECOVERY_WORKER_EXECUTION_FAILED',
      },
      { status: 500 },
    );
  } finally {
    if (client !== null) {
      if (tenantBound) {
        try {
          await client.query('RESET app.tenant_id');
        } catch {
          client.release(true);
          client = null;
        }
      }
      client?.release();
    }
  }
}
