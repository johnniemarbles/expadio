import { NextResponse } from 'next/server';
import { resolveBrandContext } from '../../../../../lib/brand-context';

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
    const source = new URL(request.url);
    const target = new URL('/api/learning/me/assignment-attachments', platformOrigin());
    for (const key of ['enrollmentId', 'lessonId', 'assignmentKey']) {
      const value = source.searchParams.get(key);
      if (value) target.searchParams.set(key, value);
    }
    target.searchParams.set('account', context.tenantId);
    target.searchParams.set('org', context.organizationId);
    const headers = new Headers();
    for (const name of ['cookie','content-type','content-length','x-expadio-filename','x-content-sha256','x-idempotency-key','x-correlation-id']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const response = await fetch(target, {
      method: 'POST', headers, body: new Uint8Array(await request.arrayBuffer()),
      cache: 'no-store', redirect: 'error',
    });
    return new NextResponse(response.body, {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return NextResponse.json({ denied: true, reasonKey: 'LEARNING_ATTACHMENT_SERVICE_UNAVAILABLE' }, { status: 503 });
  }
}
