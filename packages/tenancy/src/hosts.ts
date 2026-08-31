/** Product hosts. Package paths are not URLs. */
export const PLATFORM_HOST = 'platform.expadio.com' as const;
export const BRAND_HOST = 'app.expadio.com' as const;

export function hostForAudience(audience: 'platform' | 'brand'): typeof PLATFORM_HOST | typeof BRAND_HOST {
  return audience === 'platform' ? PLATFORM_HOST : BRAND_HOST;
}
