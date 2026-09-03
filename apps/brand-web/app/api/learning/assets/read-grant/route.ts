import { NextResponse } from 'next/server';
import { resolveBrandContext } from '../../../../../lib/brand-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function platformOrigin(): string {
  const raw = process.env.EXPADIO_PLATFORM_API_URL?.trim();
  if (!raw) throw new Error('PLATFORM_API_UNAVAILABLE');
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('PLATFORM_API_HTTPS_REQUIRED');
  return url.origin;
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const enrollmentId = typeof body?.enrollmentId === 'string' ? body.enrollmentId : '';
    const lessonId = typeof body?.lessonId === 'string' ? body.lessonId : '';
    const assetId = typeof body?.assetId === 'string' ? body.assetId : '';
    if (![enrollmentId, lessonId, assetId].every((value) => UUID.test(value))) {
      return NextResponse.json({ reasonKey: 'LEARNING_ASSET_TARGET_INVALID' }, { status: 400 });
    }

    const path = `/api/learning/me/enrollments/${encodeURIComponent(enrollmentId)}/lessons/${encodeURIComponent(lessonId)}/assets/${encodeURIComponent(assetId)}/read-grant`;
    const target = new URL(path, platformOrigin());
    target.searchParams.set('account', context.tenantId);
    target.searchParams.set('org', context.organizationId);
    const headers = new Headers();
    const cookie = request.headers.get('cookie');
    if (cookie) headers.set('cookie', cookie);
    const correlation = request.headers.get('x-correlation-id');
    if (correlation) headers.set('x-correlation-id', correlation);

    const response = await fetch(target, { method: 'POST', headers, cache: 'no-store', redirect: 'error' });
    return new NextResponse(response.body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return NextResponse.json(
      { denied: true, reasonKey: 'LEARNING_ASSET_SERVICE_UNAVAILABLE' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
