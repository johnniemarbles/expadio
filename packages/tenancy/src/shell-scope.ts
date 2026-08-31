/** Shared presentation contract for Platform and Brand; NOT authorization. */
export type ShellAudience = 'platform' | 'brand';
export type ScopeValue<T> = Readonly<{ state: 'unresolved' }> | Readonly<{ state: 'resolved'; value: T }>;
export type TenantCode = `T-${string}`;
export type BrandCode = `B-${string}`;
export type LocationCode = `L-${string}`;
export type LocationView = Readonly<{ kind: 'all-permitted' }> | Readonly<{ kind: 'location'; id: LocationCode }>;
export type RoleHome = 'platform' | 'owner' | 'manager' | 'operator' | 'approver';

export interface ShellScope {
  readonly version: 1;
  readonly audience: ShellAudience;
  readonly tenant: ScopeValue<TenantCode>;
  readonly brand: ScopeValue<BrandCode>;
  readonly location: ScopeValue<LocationView>;
  /** Descriptive, server-resolved context. Never a count/data filter. */
  readonly pack: ScopeValue<Readonly<{ key: string; version: number }> | null>;
  /** Residency is not inferred from location, pack, browser, or query string. */
  readonly residency: ScopeValue<string>;
  /** Role/home presentation is not a permission or a substitute for IAM. */
  readonly role: ScopeValue<Readonly<{ key: string; home: RoleHome }>>;
}

/** Storage identifiers remain separate; this is not a public product scope. */
export interface ShellScopeStorageKeys {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly operatingUnitId: string | null;
}

export const SHELL_NAVIGATION = {
  platform: ['Home', 'My work', 'Tenants', 'Capabilities', 'Sending health', 'Providers', 'Approvals', 'Safety', 'Audit'],
  brand: ['Home', 'My work', 'Customers', 'Communications', 'Growth', 'Knowledge', 'Settings'],
} as const;

/** Bootstrap display state, never a usable data scope or an access grant. */
export function unresolvedShellScope(audience: ShellAudience): ShellScope {
  return {
    version: 1, audience, tenant: { state: 'unresolved' }, brand: { state: 'unresolved' },
    location: { state: 'unresolved' }, pack: { state: 'unresolved' },
    residency: { state: 'unresolved' }, role: { state: 'unresolved' },
  };
}

function code(prefix: 'T' | 'B' | 'L', value: string): void {
  if (!new RegExp('^' + prefix + '-[0-9]{4,}$').test(value)) throw new Error('INVALID_PRODUCT_SCOPE_CODE');
}

/**
 * Display-selection identity only. Not a query, cache key or authorization proof.
 * Pack/residency/role deliberately cannot change this selection. Actual counts
 * must still be computed under the caller's current server-resolved visibility.
 */
export function shellViewSelection(scope: ShellScope): Readonly<{
  audience: ShellAudience; tenant: TenantCode; brand: BrandCode; location: LocationView;
}> {
  if (scope.tenant.state !== 'resolved' || scope.brand.state !== 'resolved' || scope.location.state !== 'resolved') {
    throw new Error('PRODUCT_SCOPE_UNRESOLVED');
  }
  code('T', scope.tenant.value); code('B', scope.brand.value);
  if (scope.location.value.kind === 'location') code('L', scope.location.value.id);
  else if (scope.location.value.kind !== 'all-permitted') throw new Error('INVALID_LOCATION_VIEW');
  return { audience: scope.audience, tenant: scope.tenant.value, brand: scope.brand.value, location: scope.location.value };
}
