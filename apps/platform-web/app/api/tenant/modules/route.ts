import { NextResponse } from 'next/server';
import { listTenantProductModules } from '@expadio/postgres-runtime/product-module';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../../lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const modules = await withTenantTransaction(context, (client) =>
      listTenantProductModules(client, context.tenantId),
    );

    return NextResponse.json(
      { modules },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
}
