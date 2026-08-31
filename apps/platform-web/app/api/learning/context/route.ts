import { NextResponse } from 'next/server';
import { loadLearningTenantContext } from '@expadio/postgres-runtime/product-module';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../../lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function learningError(error: unknown): { status: number; reasonKey: string; message: string } | null {
  if (!(error instanceof Error)) return null;
  if (error.message === 'MODULE_LOCKED_BY_PLAN') {
    return {
      status: 403,
      reasonKey: 'MODULE_LOCKED_BY_PLAN',
      message: 'Learning is suspended because the tenant no longer has an active entitlement.',
    };
  }
  if (error.message === 'MODULE_NOT_ACTIVE') {
    return {
      status: 404,
      reasonKey: 'MODULE_NOT_ACTIVE',
      message: 'Learning has not been activated for this tenant.',
    };
  }
  if (error.message === 'MODULE_UNAVAILABLE') {
    return {
      status: 404,
      reasonKey: 'MODULE_UNAVAILABLE',
      message: 'Learning is unavailable.',
    };
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const learning = await withTenantTransaction(context, (client) =>
      loadLearningTenantContext(client, context.tenantId),
    );
    return NextResponse.json(learning, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const mapped = learningError(error);
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
