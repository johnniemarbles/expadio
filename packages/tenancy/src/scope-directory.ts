import type { BrandCode, LocationCode, ShellScope, ShellScopeStorageKeys, TenantCode } from './shell-scope.ts';
import { shellViewSelection } from './shell-scope.ts';
import { ScopeMappingError, parseBrandCode, parseLocationCode, parseTenantCode } from './scope-adapter.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VerifiedScopeBinding = {
  readonly tenant: TenantCode;
  readonly brand: BrandCode;
  readonly location: LocationCode | 'all-permitted';
  readonly tenantId: string;
  readonly organizationId: string;
  readonly operatingUnitId: string | null;
};

export type ScopeDirectory = {
  resolve(scope: ShellScope): ShellScopeStorageKeys;
};

function assertUuid(label: string, value: string): void {
  if (!UUID.test(value)) {
    throw new ScopeMappingError('STORAGE_KEY_IS_NOT_UUID', label + ' must be a storage UUID, not a product code.');
  }
}

function keyOf(tenant: TenantCode, brand: BrandCode, location: LocationCode | 'all-permitted'): string {
  return tenant + '\0' + brand + '\0' + location;
}

/**
 * In-memory verified bindings. This is not a production allocation table and
 * does not mint T/B/L codes. Both shells must use the same directory instance.
 */
export function createScopeDirectory(bindings: readonly VerifiedScopeBinding[]): ScopeDirectory {
  const tenants = new Map<TenantCode, string>();
  const brands = new Map<string, { tenantId: string; organizationId: string }>();
  const rows = new Map<string, VerifiedScopeBinding>();

  for (const binding of bindings) {
    parseTenantCode(binding.tenant);
    parseBrandCode(binding.brand);
    if (binding.location !== 'all-permitted') parseLocationCode(binding.location);
    assertUuid('tenantId', binding.tenantId);
    assertUuid('organizationId', binding.organizationId);
    if (binding.operatingUnitId !== null) assertUuid('operatingUnitId', binding.operatingUnitId);
    if (binding.location === 'all-permitted' && binding.operatingUnitId !== null) {
      throw new ScopeMappingError('ALL_PERMITTED_HAS_UNIT', 'all-permitted view cannot carry a unit id.');
    }
    if (binding.location !== 'all-permitted' && binding.operatingUnitId === null) {
      throw new ScopeMappingError('LOCATION_MISSING_UNIT', 'A location view must name its operating unit.');
    }

    const existingTenant = tenants.get(binding.tenant);
    if (existingTenant && existingTenant !== binding.tenantId) {
      throw new ScopeMappingError('TENANT_CODE_CONFLICT', 'One T-code cannot map to two tenant ids.');
    }
    tenants.set(binding.tenant, binding.tenantId);

    const brandKey = binding.tenant + '\0' + binding.brand;
    const existingBrand = brands.get(brandKey);
    if (existingBrand && (existingBrand.tenantId !== binding.tenantId || existingBrand.organizationId !== binding.organizationId)) {
      throw new ScopeMappingError('BRAND_OWNERSHIP_CONFLICT', 'One B-code cannot change tenant or organization inside a directory.');
    }
    brands.set(brandKey, { tenantId: binding.tenantId, organizationId: binding.organizationId });

    const rowKey = keyOf(binding.tenant, binding.brand, binding.location);
    if (rows.has(rowKey)) throw new ScopeMappingError('DUPLICATE_BINDING', 'Duplicate T/B/L binding.');
    rows.set(rowKey, binding);
  }

  return {
    resolve(scope: ShellScope): ShellScopeStorageKeys {
      if (rows.size === 0) {
        throw new ScopeMappingError('PRODUCT_SCOPE_MAPPING_UNAVAILABLE', 'No verified T/B/L bindings are registered.');
      }
      const view = shellViewSelection(scope);
      const location = view.location.kind === 'all-permitted' ? 'all-permitted' : view.location.id;
      const row = rows.get(keyOf(view.tenant, view.brand, location));
      if (!row) {
        throw new ScopeMappingError('PRODUCT_SCOPE_MAPPING_NOT_FOUND', 'No verified binding for this T/B/L selection.');
      }
      return {
        tenantId: row.tenantId,
        organizationId: row.organizationId,
        operatingUnitId: row.operatingUnitId,
      };
    },
  };
}
