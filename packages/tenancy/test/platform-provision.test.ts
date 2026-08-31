import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRequestPath } from '../src/audience-boundary.ts';
import { parsePlatformProvisionInput, platformProvisionResult } from '../src/platform-provision.ts';

test('provision requires operator-supplied product codes', () => {
  const command = parsePlatformProvisionInput({
    tenantCode: 'T-0001',
    brandCode: 'B-0001',
    locationCode: 'L-0001',
  });
  assert.equal(command.createTenant, false);
  assert.equal(command.organizationLabel, 'Brand workspace');
  assert.equal(command.locationCode, 'L-0001');
});

test('provision accepts ALL location and rejects storage UUIDs', () => {
  const command = parsePlatformProvisionInput({
    tenantCode: 'T-0048',
    brandCode: 'B-0002',
    locationCode: 'ALL',
    createTenant: true,
    tenantLabel: 'Acme Ops',
  });
  assert.equal(command.locationCode, 'ALL');
  assert.equal(command.createTenant, true);
  assert.throws(
    () =>
      parsePlatformProvisionInput({
        tenantCode: '00000000-0000-0000-0000-000000000001',
        brandCode: 'B-0001',
        locationCode: 'L-0001',
      }),
    /STORAGE_KEY_IS_NOT_PRODUCT_CODE/,
  );
});

test('provision result is platform-safe and points at Brand fallback', () => {
  const result = platformProvisionResult({
    tenant_code: 'T-0001',
    brand_code: 'B-0001',
    location_code: 'L-0001',
    tenant_id: '00000000-0000-0000-0000-000000000001',
    organization_id: '00000000-0000-0000-0000-000000000002',
    operating_unit_id: '00000000-0000-0000-0000-000000000003',
  });
  assert.equal(result.brandHref, '/brand?tenant=T-0001&brand=B-0001&location=L-0001&view=customers');
  assert.equal(classifyRequestPath('/api/tenants/provision'), 'platform-product');
  assert.equal(classifyRequestPath('/api/tenant/customers'), 'lab');
});
