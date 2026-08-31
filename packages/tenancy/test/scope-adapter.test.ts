import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ScopeMappingError,
  mapShellScopeToStorageKeys,
  parseBrandCode,
  parseLocationCode,
  parseTenantCode,
  unresolvedShellScope,
} from '../src/index.ts';

test('product codes reject storage UUIDs and the wrong namespace', () => {
  assert.throws(() => parseTenantCode('00000000-0000-0000-0000-000000000001'), ScopeMappingError);
  assert.throws(() => parseTenantCode('B-0001'), ScopeMappingError);
  assert.throws(() => parseBrandCode('T-0001'), ScopeMappingError);
  assert.throws(() => parseLocationCode('L-ab'), ScopeMappingError);
  assert.equal(parseTenantCode('T-1048'), 'T-1048');
});

test('adapter does not invent storage keys from a resolved product scope', () => {
  const scope = {
    ...unresolvedShellScope('brand'),
    tenant: { state: 'resolved' as const, value: 'T-1048' as const },
    brand: { state: 'resolved' as const, value: 'B-0001' as const },
    location: { state: 'resolved' as const, value: { kind: 'location' as const, id: 'L-0009' as const } },
  };
  assert.throws(() => mapShellScopeToStorageKeys(scope), (error: unknown) => (
    error instanceof ScopeMappingError && error.code === 'PRODUCT_SCOPE_MAPPING_UNAVAILABLE'
  ));
});
