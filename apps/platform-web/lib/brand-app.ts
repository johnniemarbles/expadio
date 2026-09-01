function normalizedOrigin(raw: string): string {
  const url = new URL(raw);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('BRAND_APP_ORIGIN_INVALID');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('BRAND_APP_ORIGIN_INVALID');
  }
  return url.origin;
}

export function loadBrandAppOrigin(): string | null {
  const configured =
    process.env.EXPADIO_BRAND_APP_URL?.trim()
    || process.env.NEXT_PUBLIC_BRAND_APP_URL?.trim();
  if (configured) return normalizedOrigin(configured);
  if (process.env.NODE_ENV === 'development') return 'http://localhost:3001';
  return null;
}

export function brandHandoffUrl(
  origin: string,
  input: {
    readonly tenantId: string;
    readonly organizationId: string;
    readonly returnTo?: string;
  },
): string {
  const url = new URL('/handoff', origin);
  url.searchParams.set('tenant', input.tenantId);
  url.searchParams.set('org', input.organizationId);
  url.searchParams.set('returnTo', input.returnTo ?? '/');
  return url.toString();
}
