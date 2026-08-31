import { BRAND_APP, BRAND_HOST, PLATFORM_HOST } from '../../packages/tenancy/src/index.ts';

/** Product Brand host. /brand on Platform is fallback only. */
export const BRAND_PUBLIC_ORIGIN = `https://${BRAND_HOST}`;
export const BRAND_FALLBACK_PREFIX = '/brand';

export function isBrandProductHost(host: string): boolean {
  return host.replace(/^https?:\/\//i, '').split(':')[0]?.toLowerCase() === BRAND_HOST;
}

export function isPlatformProductHost(host: string): boolean {
  return host.replace(/^https?:\/\//i, '').split(':')[0]?.toLowerCase() === PLATFORM_HOST;
}

export function brandPublicPath(path: string): string {
  const bare = path.startsWith('/') ? path : `/${path}`;
  if (bare === BRAND_FALLBACK_PREFIX || bare.startsWith(`${BRAND_FALLBACK_PREFIX}/`)) {
    return bare.slice(BRAND_FALLBACK_PREFIX.length) || '/';
  }
  return bare;
}

export const BRAND_HOST_CONTRACT = {
  app: BRAND_APP,
  publicOrigin: BRAND_PUBLIC_ORIGIN,
  fallbackPrefix: BRAND_FALLBACK_PREFIX,
  deployed: false,
} as const;
