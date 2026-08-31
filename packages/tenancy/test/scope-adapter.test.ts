import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ScopeMappingError,
  createScopeDirectory,
  mapShellScopeToStorageKeys,
  parseBrandCode,
  parseLocationCode,
  parseTenantCode,
  unresolvedShellScope,
} from '../src/index.ts';

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const ORG_ID = '20000000-0000-0000-0000-000000000001';
const UNIT_ID = '30000000-0000-0000-0000-000000000001';

function selected() {
  return {
    ...unresolvedShellScope('brand'),
    tenant: { state: 'resolved' as const, value: 'T-1048' as const },
    brand: { state: 'resolved' as const, value: 'B-0001' as const },
    location: { state: 'resolved' as const, value: { kind: 'location' as const, id: 'L-0009' as const } },
  };
}

test('product codes reject storage UUIDs and the wrong namespace', () => {
  assert.throws(() => parseTenantCode('00000000-0000-0000-0000-000000000001'), ScopeMappingError);
  assert.throws(() => parseTenantCode('B-0001'), ScopeMappingError);
  assert.throws(() => parseBrandCode('T-0001'), ScopeMappingError);
  assert.throws(() => parseLocationCode('L-ab'), ScopeMappingError);
  assert.equal(parseTenantCode('T-1048'), 'T-1048');
});

test('adapter does not invent storage keys without a directory', () => {
  assert.throws(() => mapShellScopeToStorageKeys(selected()), (error: unknown) => (
    error instanceof ScopeMappingError && error.code === 'PRODUCT_SCOPE_MAPPING_UNAVAILABLE'
  ));
});

test('empty directory stays unavailable', () => {
  assert.throws(() => mapShellScopeToStorageKeys(selected(), createScopeDirectory([])), (error: unknown) => (
    error instanceof ScopeMappingError && error.code === 'PRODUCT_SCOPE_MAPPING_UNAVAILABLE'
  ));
});

test('verified binding returns storage keys and never derives them from the code', () => {
  const directory = createScopeDirectory([{
    tenant: 'T-1048', brand: 'B-0001', location: 'L-0009',
    tenantId: TENANT_ID, organizationId: ORG_ID, operatingUnitId: UNIT_ID,
  }]);
  assert.deepEqual(mapShellScopeToStorageKeys(selected(), directory), {
    tenantId: TENANT_ID, organizationId: ORG_ID, operatingUnitId: UNIT_ID,
  });
});

test('missing location is not broadened to all-permitted', () => {
  const directory = createScopeDirectory([{
    tenant: 'T-1048', brand: 'B-0001', location: 'all-permitted',
    tenantId: TENANT_ID, organizationId: ORG_ID, operatingUnitId: null,
  }]);
  assert.throws(() => mapShellScopeToStorageKeys(selected(), directory), (error: unknown) => (
    error instanceof ScopeMappingError && error.code === 'PRODUCT_SCOPE_MAPPING_NOT_FOUND'
  ));
});

test('directory rejects a T-code mapped to two tenant ids', () => {
  assert.throws(() => createScopeDirectory([
    { tenant: 'T-1048', brand: 'B-0001', location: 'all-permitted', tenantId: TENANT_ID, organizationId: ORG_ID, operatingUnitId: null },
    { tenant: 'T-1048', brand: 'B-0002', location: 'all-permitted', tenantId: '40000000-0000-0000-0000-000000000001', organizationId: '50000000-0000-0000-0000-000000000001', operatingUnitId: null },
  ]), (error: unknown) => error instanceof ScopeMappingError && error.code === 'TENANT_CODE_CONFLICT');
});
