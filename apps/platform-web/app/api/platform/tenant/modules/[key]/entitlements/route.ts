import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  grantTenantModuleEntitlement,
  listTenantModuleEntitlements,
  TENANT_MODULE_ENTITLEMENT_SOURCE_TYPES,
  type TenantModuleEntitlementSourceType,
} from '@expadio/postgres-runtime/product-module';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';
import { hasPlatformAdministrationRole } from '@/lib/governance-authz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof Error)) return null;
  switch (error.message) {
    case 'MODULE_UNAVAILABLE':
      return NextResponse.json(
        { denied: true, reasonKey: 'MODULE_UNAVAILABLE', message: 'Module is unavailable.' },
        { status: 404 },
      );
    case 'MODULE_ENTITLEMENT_SOURCE_KEY_REQUIRED':
    case 'MODULE_ENTITLEMENT_SOURCE_TYPE_INVALID':
    case 'MODULE_ENTITLEMENT_WINDOW_INVALID':
      return NextResponse.json(
        { denied: true, reasonKey: error.message, message: 'The entitlement definition is invalid.' },
        { status: 400 },
      );
    default:
      return null;
  }
}

function date(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${field}_INVALID`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${field}_INVALID`);
  return parsed;
}

async function requirePlatformAdmin(
  client: import('pg').PoolClient,
  subjectId: string,
): Promise<void> {
  if (!(await hasPlatformAdministrationRole(client, subjectId))) {
    throw Object.assign(new Error('PLATFORM_ADMIN_REQUIRED'), { status: 403 });
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const moduleKey = decodeURIComponent((await params).key).trim().toLowerCase();
    const entitlements = await withTenantTransaction(context, async (client) => {
      await requirePlatformAdmin(client, context.subjectId);
      return listTenantModuleEntitlements(client, {
        tenantId: context.tenantId,
        moduleKey,
      });
    });
    return NextResponse.json(
      { entitlements },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error: any) {
    if (error?.message === 'PLATFORM_ADMIN_REQUIRED') {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'Platform administration is required to view commercial entitlement history.' },
        { status: 403 },
      );
    }
    const mapped = errorResponse(error);
    if (mapped) return mapped;
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const moduleKey = decodeURIComponent((await params).key).trim().toLowerCase();
    const body = await request.json() as Record<string, unknown>;

    const sourceType = typeof body.sourceType === 'string'
      ? body.sourceType.trim().toUpperCase()
      : '';
    if (!TENANT_MODULE_ENTITLEMENT_SOURCE_TYPES.includes(
      sourceType as TenantModuleEntitlementSourceType,
    )) {
      return NextResponse.json(
        { denied: true, reasonKey: 'MODULE_ENTITLEMENT_SOURCE_TYPE_INVALID', message: 'Choose a supported entitlement source.' },
        { status: 400 },
      );
    }

    const sourceKey = typeof body.sourceKey === 'string' ? body.sourceKey.trim() : '';
    if (!sourceKey || sourceKey.length > 160) {
      return NextResponse.json(
        { denied: true, reasonKey: 'MODULE_ENTITLEMENT_SOURCE_KEY_REQUIRED', message: 'A source key of 1–160 characters is required.' },
        { status: 400 },
      );
    }

    let validFrom: Date | undefined;
    let validUntil: Date | null = null;
    try {
      validFrom = date(body.validFrom, 'VALID_FROM');
      validUntil = date(body.validUntil, 'VALID_UNTIL') ?? null;
    } catch {
      return NextResponse.json(
        { denied: true, reasonKey: 'MODULE_ENTITLEMENT_WINDOW_INVALID', message: 'Use valid ISO dates for the entitlement window.' },
        { status: 400 },
      );
    }

    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (note.length > 500) {
      return NextResponse.json(
        { denied: true, reasonKey: 'MODULE_ENTITLEMENT_NOTE_TOO_LONG', message: 'Entitlement note must be 500 characters or fewer.' },
        { status: 400 },
      );
    }

    const result = await withTenantTransaction(context, async (client) => {
      await requirePlatformAdmin(client, context.subjectId);
      return grantTenantModuleEntitlement(client, {
        tenantId: context.tenantId,
        moduleKey,
        sourceType: sourceType as TenantModuleEntitlementSourceType,
        sourceKey,
        ...(validFrom ? { validFrom } : {}),
        validUntil,
        metadata: note ? { note } : {},
        actorSubjectId: context.subjectId,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      });
    });

    return NextResponse.json(
      result,
      {
        status: result.idempotent ? 200 : 201,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  } catch (error: any) {
    if (error?.message === 'PLATFORM_ADMIN_REQUIRED') {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'Only Platform administration can grant module entitlement.' },
        { status: 403 },
      );
    }
    const mapped = errorResponse(error);
    if (mapped) return mapped;
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
