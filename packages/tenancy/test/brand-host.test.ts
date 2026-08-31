import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRAND_HOST,
  BrandHostError,
  authorizeBrandCustomerRequest,
  createScopeDirectoryFromRows,
  serveBrandCustomerRead,
  unresolvedShellScope,
  type BrandIncomingRequest,
} from '../src/index.ts';

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const ORG_ID = '20000000-0000-0000-0000-000000000001';
const UNIT_ID = '30000000-0000-0000-0000-000000000001';

const ALL_ROW = {
  tenant_code: 'T-1048',
  brand_code: 'B-0001',
  location_code: 'ALL',
  tenant_id: TENANT_ID,
  organization_id: ORG_ID,
  operating_unit_id: null,
};

const LOCATION_ROW = {
  ...ALL_ROW,
  location_code: 'L-0009',
  operating_unit_id: UNIT_ID,
};

const identity = { subjectId: 'user-1', actorKind: 'user' as const, issuer: 'https://clerk.expadio.com' };
const allMembership = { tenantId: TENANT_ID, organizationId: ORG_ID };

function brandAllPermitted(): BrandIncomingRequest['scope'] {
  return {
    ...unresolvedShellScope('brand'),
    tenant: { state: 'resolved', value: 'T-1048' },
    brand: { state: 'resolved', value: 'B-0001' },
    location: { state: 'resolved', value: { kind: 'all-permitted' } },
  };
}

function brandLocation(): BrandIncomingRequest['scope'] {
  return {
    ...unresolvedShellScope('brand'),
    tenant: { state: 'resolved', value: 'T-1048' },
    brand: { state: 'resolved', value: 'B-0001' },
    location: { state: 'resolved', value: { kind: 'location', id: 'L-0009' } },
  };
}

function request(overrides: Partial<BrandIncomingRequest> = {}): BrandIncomingRequest {
  return {
    host: BRAND_HOST,
    path: '/api/brand/customers',
    identity,
    scope: brandAllPermitted(),
    memberships: [allMembership],
    ...overrides,
  };
}

test('Brand host serves customers only after host, mapping and ALL membership', async () => {
  const directory = createScopeDirectoryFromRows([ALL_ROW]);
  const response = await serveBrandCustomerRead(request(), directory, async (keys, context) => {
    assert.equal(keys.tenantId, TENANT_ID);
    assert.equal(keys.organizationId, ORG_ID);
    assert.equal(keys.operatingUnitId, null);
    assert.equal(context.subjectId, 'user-1');
    return { items: [{ id: 'c-1' }], hasMore: false };
  });
  assert.equal(response.status, 200);
  assert.equal(response.served, true);
  assert.equal(response.source, 'brand-audience');
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(response.body, { items: [{ id: 'c-1' }], hasMore: false });
});

test('Platform host cannot serve Brand customers',
  () => {
    const directory = createScopeDirectoryFromRows([ALL_ROW]);
    assert.throws(
      () => authorizeBrandCustomerRequest(request({ host: 'platform.expadio.com' }), directory),
      (error: unknown) => error instanceof BrandHostError && error.code === 'BRAND_READS_NOT_PLATFORM_TENANT_API',
    );
  },
);

test('Platform tenant lab path is refused on the Brand host', () => {
  const directory = createScopeDirectoryFromRows([ALL_ROW]);
  assert.throws(
    () => authorizeBrandCustomerRequest(request({ path: '/api/tenant' }), directory),
    (error: unknown) => error instanceof BrandHostError && error.code === 'BRAND_READS_NOT_PLATFORM_TENANT_API',
  );
});

test('mapped L-code stays closed until CRM unit ownership exists', () => {
  const directory = createScopeDirectoryFromRows([LOCATION_ROW]);
  assert.throws(
    () => authorizeBrandCustomerRequest(request({ scope: brandLocation() }), directory),
    (error: unknown) => error instanceof BrandHostError && error.code === 'LOCATION_SCOPE_UNAVAILABLE',
  );
});

test('missing membership is denied', () => {
  const directory = createScopeDirectoryFromRows([ALL_ROW]);
  assert.throws(
    () => authorizeBrandCustomerRequest(request({ memberships: [] }), directory),
    (error: unknown) => error instanceof BrandHostError && error.code === 'NO_MEMBERSHIP',
  );
});

test('SELECTED location membership stays fail-closed', () => {
  const directory = createScopeDirectoryFromRows([ALL_ROW]);
  assert.throws(
    () => authorizeBrandCustomerRequest(
      request({ memberships: [{ ...allMembership, operatingUnitIds: [UNIT_ID] }] }),
      directory,
    ),
    (error: unknown) => error instanceof BrandHostError && error.code === 'RESTRICTED_SCOPE_UNAVAILABLE',
  );
});
