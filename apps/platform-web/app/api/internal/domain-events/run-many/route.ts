import { NextResponse } from 'next/server';
import { dbPool } from '../../../../../lib/iam-adapter';
import {
  InternalWorkerAuthError,
  authenticateInternalWorkerToken,
  parseInternalWorkerTenantId,
} from '../../../../../lib/internal-worker-auth';
import {
  runDomainEventActionWorkerForTenants,
} from '../../../../../lib/domain-event-multi-tenant-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_PER_TENANT_LIMIT = 10;
const MAX_PER_TENANT_LIMIT = 100;
const MAX_TENANTS = 50;
const MAX_TOTAL_ITEMS = 500;

function badRequest(reasonCode: string, message: string): never {
  throw new InternalWorkerAuthError(400, reasonCode, message);
}

function parseTenantIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return badRequest(
      'INTERNAL_WORKER_TENANTS_REQUIRED',
      'tenantIds must contain at least one tenant UUID.',
    );
  }
  if (value.length > MAX_TENANTS) {
    return badRequest(
      'INTERNAL_WORKER_TENANT_LIMIT_EXCEEDED',
      `At most ${MAX_TENANTS} tenants may be processed per invocation.`,
    );
  }

  const tenantIds = value.map(parseInternalWorkerTenantId);
  if (new Set(tenantIds).size !== tenantIds.length) {
    return badRequest(
      'INTERNAL_WORKER_DUPLICATE_TENANT',
      'tenantIds must not contain duplicates.',
    );
  }
  return tenantIds;
}

function parsePerTenantLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_PER_TENANT_LIMIT;
  if (!Number.isInteger(value) || (value as number) <= 0) {
    return badRequest(
      'INTERNAL_WORKER_LIMIT_INVALID',
      'perTenantLimit must be a positive integer.',
    );
  }
  return Math.min(value as number, MAX_PER_TENANT_LIMIT);
}

export async function POST(request: Request) {
  try {
    authenticateInternalWorkerToken(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest(
        'INTERNAL_WORKER_BODY_INVALID',
        'Request body must be valid JSON.',
      );
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return badRequest(
        'INTERNAL_WORKER_BODY_INVALID',
        'Request body must be a JSON object.',
      );
    }

    const raw = body as Record<string, unknown>;
    const tenantIds = parseTenantIds(raw.tenantIds);
    const perTenantLimit = parsePerTenantLimit(raw.perTenantLimit);

    if (tenantIds.length * perTenantLimit > MAX_TOTAL_ITEMS) {
      return badRequest(
        'INTERNAL_WORKER_TOTAL_LIMIT_EXCEEDED',
        `At most ${MAX_TOTAL_ITEMS} work items may be requested per invocation.`,
      );
    }

    const summary = await runDomainEventActionWorkerForTenants(dbPool, {
      tenantIds,
      perTenantLimit,
    });

    return NextResponse.json({
      ok: summary.failedTenants === 0,
      summary,
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
        error: 'Multi-tenant Domain Event worker execution failed.',
        reasonCode: 'INTERNAL_WORKER_EXECUTION_FAILED',
      },
      { status: 500 },
    );
  }
}
