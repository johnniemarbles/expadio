import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRAND_HOST,
  ScopeMappingError,
  assertNotPlatformTenantLab,
  createScopeDirectoryFromRows,
  planBrandCustomerRead,
  unresolvedShellScope,
} from '../src/index.ts';

const ROW = {
  tenant_code: 'T-1048',
  brand_code: 'B-0001',
  location_code: 'L-0009',
  tenant_id: '10000000-0000-0000-0000-000000000001',
  organization_id: '20000000-0000-0000-0000-000000000001',
  operating_unit_id: '30000000-0000-0000-0000-000000000001',
};

function selected() {
  return {
    ...unresolvedShellScope('brand'),
    tenant: { state: 'resolved' as const, value: 'T-1048' as const },
    brand: { state: 'resolved' as const, value: 'B-0001' as const },
    location: { state: 'resolved' as const, value: { kind: 'location' as const, id: 'L-0009' as const } },
  };
}

test('persisted rows become directory keys without inventing UUIDs', () => {
  const directory = createScopeDirectoryFromRows([ROW]);
  const plan = planBrandCustomerRead(selected(), directory);
  assert.equal(plan.state, 'keys-resolved');
  if (plan.state !== 'keys-resolved') return;
  assert.equal(plan.host, BRAND_HOST);
  assert.equal(plan.route, '/api/brand/customers');
  assert.equal(plan.served, false);
  assert.equal(plan.source, 'brand-audience');
  assert.deepEqual(plan.storageKeys, {
    tenantId: ROW.tenant_id,
    organizationId: ROW.organization_id,
    operatingUnitId: ROW.operating_unit_id,
  });
});

test('ALL row does not satisfy an L-code view', () => {
  const directory = createScopeDirectoryFromRows([{ ...ROW, location_code: 'ALL', operating_unit_id: null }]);
  const plan = planBrandCustomerRead(selected(), directory);
  assert.equal(plan.state, 'mapping-unavailable');
  if (plan.state === 'mapping-unavailable') assert.equal(plan.reason, 'PRODUCT_SCOPE_MAPPING_NOT_FOUND');
});

test('Brand reads refuse the Platform tenant lab', () => {
  assert.throws(
    () => assertNotPlatformTenantLab('https://platform.expadio.com/api/tenant?account=x'),
    (error: unknown) => error instanceof ScopeMappingError && error.code === 'BRAND_READS_NOT_PLATFORM_TENANT_API',
  );
  assert.throws(() => assertNotPlatformTenantLab('/api/tenant'));
  assert.doesNotThrow(() => assertNotPlatformTenantLab('https://app.expadio.com/api/brand/customers'));
});

test('Platform audience cannot plan a Brand customer read', () => {
  assert.throws(() => planBrandCustomerRead(unresolvedShellScope('platform')), /WRONG_AUDIENCE/);
});
