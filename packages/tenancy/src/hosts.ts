/** Product hosts. Package paths are not URLs. */
export const PLATFORM_HOST = 'platform.expadio.com';
export const BRAND_HOST = 'app.expadio.com';

export function hostForAudience(audience: 'platform' | 'brand'): string {
  return audience === 'platform' ? PLATFORM_HOST : BRAND_HOST;
}
