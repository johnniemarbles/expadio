import { auth } from '@clerk/nextjs/server';
import type { BrandContext } from './brand-context';

function platformOrigin(): URL {
  const raw = process.env.EXPADIO_PLATFORM_ORIGIN?.trim() || 'https://platform.expadio.com';
  const origin = new URL(raw);
  const local = origin.hostname === 'localhost' || origin.hostname === '127.0.0.1';
  if (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) {
    throw new Error('PLATFORM_ORIGIN_INVALID');
  }
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('PLATFORM_ORIGIN_INVALID');
  }
  return origin;
}

export async function platformLearningAiFetch(
  context: BrandContext,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  if (!path.startsWith('/api/learning/ai/')) throw new Error('PLATFORM_AI_PATH_INVALID');
  const session = await auth();
  if (!session.userId || session.userId !== context.subjectId) throw new Error('BRAND_SESSION_MISMATCH');
  const token = await session.getToken();
  if (!token) throw new Error('BRAND_SESSION_TOKEN_UNAVAILABLE');

  const url = new URL(path, platformOrigin());
  url.searchParams.set('account', context.tenantId);
  url.searchParams.set('org', context.organizationId);

  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${token}`);
  headers.set('accept', 'application/json');
  if (init?.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  return fetch(url, {
    ...init,
    headers,
    cache: 'no-store',
    redirect: 'error',
  });
}
