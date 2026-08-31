/** Product hosts. Package paths are not URLs. */
export const PLATFORM_HOST = 'platform.expadio.com' as const;
export const BRAND_HOST = 'app.expadio.com' as const;
export const BRAND_PUBLIC_ORIGIN = `https://${BRAND_HOST}` as const;
export const BRAND_FALLBACK_PREFIX = '/brand' as const;

export function hostForAudience(audience: 'platform' | 'brand'): typeof PLATFORM_HOST | typeof BRAND_HOST {
  return audience === 'platform' ? PLATFORM_HOST : BRAND_HOST;
}

function hostname(host: string): string {
  return host.replace(/^https?:\/\//i, '').split('/')[0]?.split(':')[0]?.toLowerCase() ?? '';
}

export function isBrandProductHost(host: string): boolean {
  return hostname(host) === BRAND_HOST;
}

export function isPlatformProductHost(host: string): boolean {
  return hostname(host) === PLATFORM_HOST;
}

/** Strip same-origin fallback prefix. Product Brand paths live at the origin root. */
export function brandPublicPath(path: string): string {
  const bare = path.startsWith('/') ? path : `/${path}`;
  if (bare === BRAND_FALLBACK_PREFIX || bare.startsWith(`${BRAND_FALLBACK_PREFIX}/`)) {
    return bare.slice(BRAND_FALLBACK_PREFIX.length) || '/';
  }
  return bare;
}

export function brandHostStatus(runtimeHost?: string): {
  readonly publicOrigin: typeof BRAND_PUBLIC_ORIGIN;
  readonly fallbackPrefix: typeof BRAND_FALLBACK_PREFIX;
  readonly productHost: typeof BRAND_HOST;
  readonly deployed: false;
  readonly currentIsProductHost: boolean;
  readonly currentIsFallback: boolean;
} {
  const current = runtimeHost ? hostname(runtimeHost) : '';
  return {
    publicOrigin: BRAND_PUBLIC_ORIGIN,
    fallbackPrefix: BRAND_FALLBACK_PREFIX,
    productHost: BRAND_HOST,
    deployed: false,
    currentIsProductHost: current === BRAND_HOST,
    currentIsFallback: current !== BRAND_HOST,
  };
}
