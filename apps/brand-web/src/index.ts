import {
  BRAND_HOST,
  SHELL_NAVIGATION,
  unresolvedShellScope,
  type ShellScope,
} from '@expadio/tenancy';

export const BRAND_APP = {
  package: '@expadio/brand-web',
  host: BRAND_HOST,
  path: '/',
  audience: 'brand' as const,
  nav: SHELL_NAVIGATION.brand,
};

export type BrandSurface =
  | 'home'
  | 'work'
  | 'customers'
  | 'communications'
  | 'growth'
  | 'knowledge'
  | 'settings';

const SURFACE: Record<(typeof SHELL_NAVIGATION.brand)[number], BrandSurface> = {
  Home: 'home',
  'My work': 'work',
  Customers: 'customers',
  Communications: 'communications',
  Growth: 'growth',
  Knowledge: 'knowledge',
  Settings: 'settings',
};

export type BrandSurfaceState =
  | { state: 'unresolved-scope'; reason: 'PRODUCT_SCOPE_UNRESOLVED' }
  | { state: 'planned'; reason: 'SURFACE_NOT_CONNECTED' }
  | { state: 'mapping-unavailable'; reason: 'PRODUCT_SCOPE_MAPPING_UNAVAILABLE' };

/** Brand shell bootstrap. Live customer reads stay disconnected until the adapter exists. */
export function brandWorkspace(scope: ShellScope = unresolvedShellScope('brand')): {
  app: typeof BRAND_APP;
  scope: ShellScope;
  surfaces: Record<BrandSurface, BrandSurfaceState>;
} {
  if (scope.audience !== 'brand') throw new Error('WRONG_AUDIENCE');
  const unresolved =
    scope.tenant.state !== 'resolved' ||
    scope.brand.state !== 'resolved' ||
    scope.location.state !== 'resolved';
  const status: BrandSurfaceState = unresolved
    ? { state: 'unresolved-scope', reason: 'PRODUCT_SCOPE_UNRESOLVED' }
    : { state: 'mapping-unavailable', reason: 'PRODUCT_SCOPE_MAPPING_UNAVAILABLE' };
  const surfaces = Object.fromEntries(
    SHELL_NAVIGATION.brand.map((label) => {
      const key = SURFACE[label];
      if (key === 'growth' || key === 'communications' || key === 'knowledge' || key === 'settings') {
        return [key, { state: 'planned', reason: 'SURFACE_NOT_CONNECTED' } satisfies BrandSurfaceState];
      }
      return [key, status];
    }),
  ) as Record<BrandSurface, BrandSurfaceState>;
  return { app: BRAND_APP, scope, surfaces };
}
