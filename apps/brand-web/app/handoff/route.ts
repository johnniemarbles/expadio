import { NextResponse } from 'next/server';
import {
  brandWorkspaceCookieNames,
  resolveBrandContext,
} from '../../lib/brand-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export async function GET(request: Request) {
  const context = await resolveBrandContext();
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant');
  const organizationId = url.searchParams.get('org');

  if (
    !tenantId
    || !organizationId
    || !UUID.test(tenantId)
    || !UUID.test(organizationId)
    || !context.workspaces.some(
      (workspace) =>
        workspace.tenantId === tenantId
        && workspace.organizationId === organizationId,
    )
  ) {
    return NextResponse.json(
      { denied: true, reasonKey: 'BRAND_WORKSPACE_ACCESS_DENIED', message: 'This Brand workspace is not available to the signed-in user.' },
      { status: 403 },
    );
  }

  const response = NextResponse.redirect(
    new URL(safeReturnTo(url.searchParams.get('returnTo')), request.url),
    303,
  );
  const options = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
  response.cookies.set(brandWorkspaceCookieNames.tenant, tenantId, options);
  response.cookies.set(brandWorkspaceCookieNames.organization, organizationId, options);
  return response;
}
