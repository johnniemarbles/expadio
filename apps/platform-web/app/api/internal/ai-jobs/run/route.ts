import { NextResponse } from 'next/server';
import { dbPool } from '../../../../../lib/iam-adapter';
import {
  InternalWorkerAuthError,
  authenticateInternalWorkerRequest,
} from '../../../../../lib/internal-worker-auth';
import {
  runAiJobWorkerOnce,
  type AiJobWorkerResult,
} from '../../../../../lib/ai-job-worker';
import {
  loadArtifactStorageEnvironment,
} from '../../../../../lib/artifact-storage-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 25;

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
    const serviceSubjectId =
      process.env.EXPADIO_AI_WORKER_SUBJECT_ID?.trim() ?? '';
    if (serviceSubjectId === '') {
      throw new InternalWorkerAuthError(
        503,
        'AI_WORKER_IDENTITY_DISABLED',
        'AI worker service identity is not configured.',
      );
    }
    const artifactStorage = loadArtifactStorageEnvironment();
    if (artifactStorage === null) {
      throw new InternalWorkerAuthError(
        503,
        'AI_ARTIFACT_STORAGE_DISABLED',
        'Durable AI artifact storage is not configured.',
      );
    }

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
    await client.query(
      "SELECT set_config('app.tenant_id', $1, false)",
      [tenantId],
    );
    tenantBound = true;

    const results: AiJobWorkerResult[] = [];
    for (let index = 0; index < limit; index += 1) {
      const result = await runAiJobWorkerOnce(client, {
        tenantId,
        options: {
          serviceSubjectId,
          artifactStorage,
        },
      });
      if (result.status === 'IDLE') break;
      results.push(result);
    }

    const counts = results.reduce<Record<string, number>>((acc, result) => {
      acc[result.status] = (acc[result.status] ?? 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      ok: true,
      tenantId,
      requestedLimit: limit,
      processed: results.length,
      counts,
      results,
    });
  } catch (error) {
    if (error instanceof InternalWorkerAuthError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          reasonCode: error.reasonCode,
        },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: 'AI job worker execution failed.',
        reasonCode: 'AI_WORKER_EXECUTION_FAILED',
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
