import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { revokeTenantModuleEntitlement } from '@expadio/postgres-runtime/product-module';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';
import { hasPlatformAdministrationRole } from '@/lib/governance-authz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: {
    params: Promise<{ key: string; entitlementId: string }>;
  },
) {
  try {
    const context = await resolveRequestContext(request);
    const resolved = await params;
    const moduleKey = decodeURIComponent(resolved.key).trim().toLowerCase();
    const entitlementId = resolved.entitlementId.trim();
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length > 500) {
      return NextResponse.json(
        { denied: true, reasonKey: 'MODULE_ENTITLEMENT_REASON_TOO_LONG', message: 'Revocation reason must be 500 characters or fewer.' },
        { status: 400 },
      );
    }

    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasPlatformAdministrationRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      const mutation = await revokeTenantModuleEntitlement(client, {
        tenantId: context.tenantId,
        moduleKey,
        entitlementId,
        actorSubjectId: context.subjectId,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
        reason: reason || null,
      });
      return { mutation } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'Only Platform administration can revoke module entitlement.' },
        { status: 403 },
      );
    }

    return NextResponse.json(
      result.mutation,
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error: any) {
    if (error instanceof Error && error.message === 'MODULE_ENTITLEMENT_NOT_FOUND') {
      return NextResponse.json(
        { denied: true, reasonKey: 'MODULE_ENTITLEMENT_NOT_FOUND', message: 'Entitlement was not found.' },
        { status: 404 },
      );
    }
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
