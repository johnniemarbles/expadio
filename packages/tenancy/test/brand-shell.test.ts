import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRAND_APP,
  BRAND_HOST,
  brandWorkspace,
  createScopeDirectory,
  unresolvedShellScope,
} from '../src/index.ts';

test('Brand app is a separate audience on the Brand host', () => {
  assert.equal(BRAND_APP.host, BRAND_HOST);
  assert.equal(BRAND_APP.path, '/');
  assert.equal(BRAND_APP.audience, 'brand');
  assert.deepEqual([...BRAND_APP.nav], ['Home', 'My work', 'Customers', 'Communications', 'Growth', 'Knowledge', 'Settings']);
});

test('unresolved scope does not pretend customer reads exist', () => {
  const workspace = brandWorkspace();
  assert.equal(workspace.surfaces.home.state, 'unresolved-scope');
  assert.equal(workspace.surfaces.customers.state, 'unresolved-scope');
  assert.equal(workspace.surfaces.growth.state, 'planned');
});

test('resolved codes still cannot read without a verified directory', () => {
  const workspace = brandWorkspace({
    ...unresolvedShellScope('brand'),
    tenant: { state: 'resolved', value: 'T-1048' },
    brand: { state: 'resolved', value: 'B-0001' },
    location: { state: 'resolved', value: { kind: 'all-permitted' } },
  });
  assert.equal(workspace.surfaces.customers.state, 'mapping-unavailable');
});

test('verified directory maps Home and Customers without opening planned surfaces', () => {
  const directory = createScopeDirectory([{
    tenant: 'T-1048', brand: 'B-0001', location: 'all-permitted',
    tenantId: '10000000-0000-0000-0000-000000000001',
    organizationId: '20000000-0000-0000-0000-000000000001',
    operatingUnitId: null,
  }]);
  const workspace = brandWorkspace({
    ...unresolvedShellScope('brand'),
    tenant: { state: 'resolved', value: 'T-1048' },
    brand: { state: 'resolved', value: 'B-0001' },
    location: { state: 'resolved', value: { kind: 'all-permitted' } },
  }, directory);
  assert.equal(workspace.surfaces.customers.state, 'mapped');
  assert.equal(workspace.surfaces.communications.state, 'planned');
});

test('Platform audience cannot open the Brand workspace helper', () => {
  assert.throws(() => brandWorkspace(unresolvedShellScope('platform')), /WRONG_AUDIENCE/);
});
