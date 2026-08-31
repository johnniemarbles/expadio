import { BRAND_HOST } from './hosts.ts';
import { SHELL_NAVIGATION, unresolvedShellScope, type ShellScope } from './shell-scope.ts';
import { mapShellScopeToStorageKeys } from './scope-adapter.ts';
import type { ScopeDirectory } from './scope-directory.ts';

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
  | { state: 'mapping-unavailable'; reason: 'PRODUCT_SCOPE_MAPPING_UNAVAILABLE' }
  | { state: 'mapped'; reason: 'STORAGE_KEYS_RESOLVED' };

export function brandWorkspace(
  scope: ShellScope = unresolvedShellScope('brand'),
  directory?: ScopeDirectory,
): {
  app: typeof BRAND_APP;
  scope: ShellScope;
  surfaces: Record<BrandSurface, BrandSurfaceState>;
} {
  if (scope.audience !== 'brand') throw new Error('WRONG_AUDIENCE');
  const unresolved =
    scope.tenant.state !== 'resolved' ||
    scope.brand.state !== 'resolved' ||
    scope.location.state !== 'resolved';

  let status: BrandSurfaceState;
  if (unresolved) {
    status = { state: 'unresolved-scope', reason: 'PRODUCT_SCOPE_UNRESOLVED' };
  } else {
    try {
      mapShellScopeToStorageKeys(scope, directory);
      status = { state: 'mapped', reason: 'STORAGE_KEYS_RESOLVED' };
    } catch {
      status = { state: 'mapping-unavailable', reason: 'PRODUCT_SCOPE_MAPPING_UNAVAILABLE' };
    }
  }

  const surfaces = Object.fromEntries(
    SHELL_NAVIGATION.brand.map((label) => {
      const key = SURFACE[label];
      if (key === 'growth' || key === 'knowledge' || key === 'settings') {
        return [key, { state: 'planned', reason: 'SURFACE_NOT_CONNECTED' } satisfies BrandSurfaceState];
      }
      return [key, status];
    }),
  ) as Record<BrandSurface, BrandSurfaceState>;
  return { app: BRAND_APP, scope, surfaces };
}
