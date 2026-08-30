import { NextResponse } from 'next/server';
import { dbPool } from '../../../../../lib/iam-adapter';
import {
  InternalWorkerAuthError,
  authenticateInternalWorkerToken,
} from '../../../../../lib/internal-worker-auth';
import {
  runDueTenantExecutionCoordinator,
} from '../../../../../lib/domain-event-tenant-coordinator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_MAX_TENANTS = 25;
const MAX_TENANTS = 50;
const DEFAULT_PER_TENANT_LIMIT = 10;
const MAX_PER_TENANT_LIMIT = 100;
const MAX_TOTAL_ITEMS = 500;

function badRequest(reasonCode: string, message: string): never {
  throw new InternalWorkerAuthError(400, reasonCode, message);
}

function positiveBoundedInteger(
  value: unknown,
  fallback: number,
  maximum: number,
  field: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) <= 0) {
    return badRequest(
      'INTERNAL_WORKER_LIMIT_INVALID',
      `${field} must be a positive integer.`,
    );
  }
  return Math.min(value as number, maximum);
}

export async function POST(request: Request) {
  try {
    authenticateInternalWorkerToken(request);

    let body: unknown = {};
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        body = await request.json();
      } catch {
        return badRequest(
          'INTERNAL_WORKER_BODY_INVALID',
          'Request body must be valid JSON.',
        );
      }
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return badRequest(
        'INTERNAL_WORKER_BODY_INVALID',
        'Request body must be a JSON object.',
      );
    }

    const raw = body as Record<string, unknown>;
    const maxTenants = positiveBoundedInteger(
      raw.maxTenants,
      DEFAULT_MAX_TENANTS,
      MAX_TENANTS,
      'maxTenants',
    );
    const perTenantLimit = positiveBoundedInteger(
      raw.perTenantLimit,
      DEFAULT_PER_TENANT_LIMIT,
      MAX_PER_TENANT_LIMIT,
      'perTenantLimit',
    );

    if (maxTenants * perTenantLimit > MAX_TOTAL_ITEMS) {
      return badRequest(
        'INTERNAL_WORKER_TOTAL_LIMIT_EXCEEDED',
        `At most ${MAX_TOTAL_ITEMS} work items may be requested per invocation.`,
      );
    }

    const result = await runDueTenantExecutionCoordinator(dbPool, {
      maxTenants,
      perTenantLimit,
    });

    return NextResponse.json({
      ok: result.summary?.failedTenants === 0 ?? true,
      ...result,
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
        error: 'Tenant execution coordinator failed.',
        reasonCode: 'INTERNAL_WORKER_COORDINATOR_FAILED',
      },
      { status: 500 },
    );
  }
}
