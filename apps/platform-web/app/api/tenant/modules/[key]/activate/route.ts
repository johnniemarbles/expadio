import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { activateLearningModule } from '@expadio/postgres-runtime/product-module';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../../../../lib/request-context';
import { hasGovernanceWriteRole } from '../../../../../../lib/governance-authz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function moduleError(error: unknown): { status: number; reasonKey: string; message: string } | null {
  if (!(error instanceof Error)) return null;
  switch (error.message) {
    case 'MODULE_LOCKED_BY_PLAN':
      return {
        status: 403,
        reasonKey: 'MODULE_LOCKED_BY_PLAN',
        message: 'This module is not available under the tenant entitlement.',
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
    const context = await resolveRequestContext(request);
    const moduleKey = decodeURIComponent((await params).key).trim().toLowerCase();

    if (moduleKey !== 'learning') {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'MODULE_PROVISIONER_NOT_IMPLEMENTED',
          message: 'This module does not have an activation provisioner yet.',
        },
        { status: 501 },
      );
    }

    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }

      const activation = await activateLearningModule(client, {
        tenantId: context.tenantId,
        actorSubjectId: context.subjectId,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      });
      return { activation } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'FORBIDDEN',
          message: 'A tenant owner or administrator must activate modules.',
        },
        { status: 403 },
      );
    }

    return NextResponse.json(
      result.activation,
      {
        status: result.activation.idempotent ? 200 : 201,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  } catch (error) {
    const mapped = moduleError(error);
    if (mapped !== null) {
      return NextResponse.json(
        { denied: true, reasonKey: mapped.reasonKey, message: mapped.message },
        { status: mapped.status, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
}
