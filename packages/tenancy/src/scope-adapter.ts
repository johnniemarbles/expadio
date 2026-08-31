import type { BrandCode, LocationCode, LocationView, ShellScope, ShellScopeStorageKeys, TenantCode } from './shell-scope.ts';
import { shellViewSelection } from './shell-scope.ts';
import type { ScopeDirectory } from './scope-directory.ts';

export class ScopeMappingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ScopeMappingError';
    this.code = code;
  }
}

const PRODUCT_CODE = /^(T|B|L)-[0-9]{4,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Product codes are never storage keys. UUIDs are never product codes. */
export function assertProductCode(kind: 'T' | 'B' | 'L', value: string): void {
  if (UUID.test(value)) {
    throw new ScopeMappingError('STORAGE_KEY_IS_NOT_PRODUCT_CODE', 'Storage UUIDs are not T/B/L identifiers.');
  }
  if (!PRODUCT_CODE.test(value) || value[0] !== kind) {
    throw new ScopeMappingError('INVALID_PRODUCT_SCOPE_CODE', 'Use T-####, B-#### or L-#### with at least four digits.');
  }
}

export function parseTenantCode(value: string): TenantCode {
  assertProductCode('T', value);
  return value as TenantCode;
}
export function parseBrandCode(value: string): BrandCode {
  assertProductCode('B', value);
  return value as BrandCode;
}
export function parseLocationCode(value: string): LocationCode {
  assertProductCode('L', value);
  return value as LocationCode;
}

/**
 * T/B/L → storage keys. Requires a verified directory.
 * Does not invent UUIDs from product codes. account/org query params stay lab-only.
 */
export function mapShellScopeToStorageKeys(scope: ShellScope, directory?: ScopeDirectory): ShellScopeStorageKeys {
  if (!directory) {
    throw new ScopeMappingError(
      'PRODUCT_SCOPE_MAPPING_UNAVAILABLE',
      'T/B/L ownership mapping is not verified. Leave storage keys unresolved. Do not infer UUIDs from product codes.',
    );
  }
  return directory.resolve(scope);
}

export function requireResolvedView(scope: ShellScope) {
  return shellViewSelection(scope);
}

export function locationViewFromCode(id: LocationCode | 'all-permitted'): LocationView {
  if (id === 'all-permitted') return { kind: 'all-permitted' };
  parseLocationCode(id);
  return { kind: 'location', id };
}
