import { NextResponse } from 'next/server';
import {
  ContextDenied,
  deniedResponse,
  resolveRequestContext,
} from '../../lib/request-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export async function GET(request: Request) {
  let context;
  try {
    context = await resolveRequestContext(request);
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }

  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant') ?? url.searchParams.get('account');
  const organizationId = url.searchParams.get('org') ?? url.searchParams.get('organization');

  if (tenantId && (!UUID.test(tenantId) || context.tenantId !== tenantId)) {
    return NextResponse.json(
      {
        denied: true,
        reasonKey: 'TENANT_ACCESS_DENIED',
        message: 'You do not have access to this workspace.',
      },
      { status: 403 },
    );
  }

  if (
    organizationId
    && (!UUID.test(organizationId) || context.organizationId !== organizationId)
  ) {
    return NextResponse.json(
      {
        denied: true,
        reasonKey: 'TENANT_ACCESS_DENIED',
        message: 'You do not have access to this workspace.',
      },
      { status: 403 },
    );
  }

  const redirectUrl = new URL(safeReturnTo(url.searchParams.get('returnTo')), request.url);
  const response = NextResponse.redirect(redirectUrl, 303);

  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  };

  response.cookies.set('expadio-tenant', context.tenantId, cookieOptions);
  if (context.organizationId) {
    response.cookies.set('expadio-org', context.organizationId, cookieOptions);
  }

  return response;
}
