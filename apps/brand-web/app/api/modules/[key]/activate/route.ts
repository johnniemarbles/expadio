import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { activateLearningModule } from '@expadio/postgres-runtime/product-module';
import { activateSimpleProductModule } from '@expadio/postgres-runtime/simple-product-module-activation';
import {
  hasBrandAdministrationRole,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPPORTED_MODULES = new Set(['learning', 'lead-management']);

function moduleError(error: unknown): { status: number; reasonKey: string; message: string } | null {
  if (!(error instanceof Error)) return null;
  switch (error.message) {
    case 'MODULE_LOCKED_BY_PLAN':
      return {
        status: 403,
        reasonKey: 'MODULE_LOCKED_BY_PLAN',
        message: 'This module is not available under the Brand entitlement.',
      };
    case 'MODULE_UNAVAILABLE':
      return { status: 404, reasonKey: 'MODULE_UNAVAILABLE', message: 'Module is unavailable.' };
    case 'MODULE_ACTIVATION_NOT_ALLOWED':
    case 'MODULE_NOT_ACTIVE':
      return {
        status: 409,
        reasonKey: 'MODULE_ACTIVATION_NOT_ALLOWED',
        message: 'The module cannot be activated from its current state.',
      };
    default:
      return null;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const context = await resolveBrandContext();
    const moduleKey = decodeURIComponent((await params).key).trim().toLowerCase();

    if (!SUPPORTED_MODULES.has(moduleKey)) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'MODULE_PROVISIONER_NOT_IMPLEMENTED',
          message: 'This module does not have a Brand activation provisioner yet.',
        },
        { status: 501, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const result = await withBrandTransaction(context, async (client) => {
      if (!(await hasBrandAdministrationRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }

      const common = {
        tenantId: context.tenantId,
        actorSubjectId: context.subjectId,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      };
      const activation = moduleKey === 'learning'
        ? await activateLearningModule(client, common)
        : await activateSimpleProductModule(client, { ...common, moduleKey: 'lead-management' });
      return { activation } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'FORBIDDEN',
          message: 'A Brand tenant owner or administrator must activate modules.',
        },
        { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    return NextResponse.json(result.activation, {
      status: result.activation.idempotent ? 200 : 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const mapped = moduleError(error);
    if (mapped !== null) {
      return NextResponse.json(
        { denied: true, reasonKey: mapped.reasonKey, message: mapped.message },
        { status: mapped.status, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    const code = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    const status = code === 'UNAUTHENTICATED' ? 401 : code === 'NO_BRAND_MEMBERSHIP' ? 403 : 400;
    return NextResponse.json(
      { denied: true, reasonKey: code, message: code },
      { status, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
