import { BRAND_HOST, PLATFORM_HOST } from './hosts.ts';
import type { ShellScope, ShellScopeStorageKeys } from './shell-scope.ts';
import { ScopeMappingError, mapShellScopeToStorageKeys } from './scope-adapter.ts';
import type { ScopeDirectory } from './scope-directory.ts';

export const BRAND_CUSTOMER_ROUTE = '/api/brand/customers';
export const PLATFORM_TENANT_LAB_ROUTE = '/api/tenant';

export type BrandCustomerReadPlan =
  | { readonly state: 'unresolved-scope'; readonly reason: 'PRODUCT_SCOPE_UNRESOLVED' }
  | { readonly state: 'mapping-unavailable'; readonly reason: string }
  | {
      readonly state: 'keys-resolved';
      readonly host: typeof BRAND_HOST;
      readonly route: typeof BRAND_CUSTOMER_ROUTE;
      readonly storageKeys: ShellScopeStorageKeys;
      readonly served: false;
      readonly source: 'brand-audience';
    };

/** Brand customer reads never ride Platform /api/tenant. */
export function assertNotPlatformTenantLab(target: string): void {
  const normalized = target.toLowerCase();
  if (
    normalized.includes(PLATFORM_HOST + PLATFORM_TENANT_LAB_ROUTE) ||
    normalized.includes(PLATFORM_TENANT_LAB_ROUTE + '/') ||
    normalized.endsWith(PLATFORM_TENANT_LAB_ROUTE) ||
    /\/api\/tenant(\?|$)/.test(normalized)
  ) {
    throw new ScopeMappingError(
      'BRAND_READS_NOT_PLATFORM_TENANT_API',
      'Brand customer reads use app.expadio.com /api/brand/*, not Platform /api/tenant.',
    );
  }
}

/**
 * Plans a Brand-audience customer read against verified storage keys.
 * Does not call CRM, does not send, does not open the Platform lab.
 */
export function planBrandCustomerRead(
  scope: ShellScope,
  directory?: ScopeDirectory,
): BrandCustomerReadPlan {
  if (scope.audience !== 'brand') throw new Error('WRONG_AUDIENCE');
  if (
    scope.tenant.state !== 'resolved' ||
    scope.brand.state !== 'resolved' ||
    scope.location.state !== 'resolved'
  ) {
    return { state: 'unresolved-scope', reason: 'PRODUCT_SCOPE_UNRESOLVED' };
  }
  try {
    const storageKeys = mapShellScopeToStorageKeys(scope, directory);
    const plan = {
      state: 'keys-resolved' as const,
      host: BRAND_HOST,
      route: BRAND_CUSTOMER_ROUTE,
      storageKeys,
      served: false as const,
      source: 'brand-audience' as const,
    };
    assertNotPlatformTenantLab(plan.host + plan.route);
    return plan;
  } catch (error) {
    const reason = error instanceof ScopeMappingError ? error.code : 'PRODUCT_SCOPE_MAPPING_UNAVAILABLE';
    return { state: 'mapping-unavailable', reason };
  }
}
