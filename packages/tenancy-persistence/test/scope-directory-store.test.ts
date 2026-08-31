import assert from 'node:assert/strict';
import test from 'node:test';
import { ScopeMappingError, unresolvedShellScope } from '@expadio/tenancy';
import { loadScopeDirectory, type ProductScopeBindingRepository } from '../src/index.ts';

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

test('empty repository stays mapping-unavailable', async () => {
  const repository: ProductScopeBindingRepository = {
    async listActiveBindings() {
      return [];
    },
  };
  const directory = await loadScopeDirectory(repository);
  assert.throws(
    () => directory.resolve(selected()),
    (error: unknown) => error instanceof ScopeMappingError && error.code === 'PRODUCT_SCOPE_MAPPING_UNAVAILABLE',
  );
});

test('repository rows resolve storage keys for both shells', async () => {
  const repository: ProductScopeBindingRepository = {
    async listActiveBindings() {
      return [{
        tenant_code: 'T-1048',
        brand_code: 'B-0001',
        location_code: 'L-0009',
        tenant_id: TENANT_ID,
        organization_id: ORG_ID,
        operating_unit_id: UNIT_ID,
      }];
    },
  };
  const directory = await loadScopeDirectory(repository);
  assert.deepEqual(directory.resolve(selected()), {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    operatingUnitId: UNIT_ID,
  });
});
