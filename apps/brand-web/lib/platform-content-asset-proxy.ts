import { NextResponse } from 'next/server';
import { hasLearningAdmin, resolveBrandContext, withBrandTransaction } from './brand-context';

function platformOrigin(): string {
  const raw = process.env.EXPADIO_PLATFORM_API_URL?.trim();
  if (!raw) throw new Error('PLATFORM_API_UNAVAILABLE');
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new Error('PLATFORM_API_HTTPS_REQUIRED');
  }
  return url.origin;
}

export async function proxyLearningAssetRequest(
  request: Request,
  path: string,
): Promise<NextResponse> {
  const context = await resolveBrandContext();
  const authorized = await withBrandTransaction(context, (client) =>
    hasLearningAdmin(client, context.subjectId),
  );
  if (!authorized) {
    return NextResponse.json({ denied: true, reasonKey: 'LEARNING_ADMIN_REQUIRED' }, { status: 403 });
  }
  if (!/^\/api\/(learning|platform)\/content-assets(?:\/|$)/.test(path)) {
    throw new Error('CONTENT_ASSET_PROXY_PATH_INVALID');
  }
  const target = new URL(path, platformOrigin());
  target.searchParams.set('account', context.tenantId);
  target.searchParams.set('org', context.organizationId);
  const headers = new Headers();
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  const correlation = request.headers.get('x-correlation-id');
  if (correlation) headers.set('x-correlation-id', correlation);
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const contentLength = request.headers.get('content-length');
  if (contentLength) headers.set('content-length', contentLength);

  const body = request.method === 'GET' ? undefined : new Uint8Array(await request.arrayBuffer());
  const response = await fetch(target, {
    method: request.method,
    headers,
    body,
    cache: 'no-store',
    redirect: 'error',
  });
  return new NextResponse(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'private, no-store',
    },
  });
}
