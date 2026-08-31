import assert from 'node:assert/strict';
import test from 'node:test';
import { SHELL_NAVIGATION, shellViewSelection, unresolvedShellScope } from '../src/index.ts';
import type { ShellAudience, ShellScope, TenantCode } from '../src/index.ts';

function selected(audience: ShellAudience): ShellScope {
  return { ...unresolvedShellScope(audience), tenant: { state: 'resolved', value: 'T-0001' },
    brand: { state: 'resolved', value: 'B-0002' },
    location: { state: 'resolved', value: { kind: 'location', id: 'L-0003' } } };
}
for (const audience of ['platform', 'brand'] as const) {
  test(audience + ' uses the same contract with unresolved bootstrap values', () => {
    const scope = unresolvedShellScope(audience);
    assert.equal(scope.audience, audience);
    for (const key of ['tenant', 'brand', 'location', 'pack', 'residency', 'role'] as const) assert.equal(scope[key].state, 'unresolved');
    assert.throws(() => shellViewSelection(scope), /PRODUCT_SCOPE_UNRESOLVED/);
  });
  test(audience + ' selection is independent of pack, residency and role presentation', () => {
    const scope = selected(audience);
    assert.deepEqual(shellViewSelection(scope), shellViewSelection({ ...scope,
      pack: { state: 'resolved', value: { key: 'neutral', version: 1 } },
      residency: { state: 'resolved', value: 'CA' },
      role: { state: 'resolved', value: { key: 'example-role', home: audience === 'brand' ? 'approver' : 'platform' } },
    }));
  });
}
test('tenant, brand and location each change the view selection', () => {
  const scope = selected('brand'); const original = shellViewSelection(scope);
  for (const changed of [
    { ...scope, tenant: { state: 'resolved', value: 'T-0009' } },
    { ...scope, brand: { state: 'resolved', value: 'B-0009' } },
    { ...scope, location: { state: 'resolved', value: { kind: 'location', id: 'L-0009' } } },
    { ...scope, location: { state: 'resolved', value: { kind: 'all-permitted' } } },
  ] as ShellScope[]) assert.notDeepEqual(shellViewSelection(changed), original);
});
test('storage UUIDs, blank codes and wrong namespaces are not product identifiers', () => {
  for (const value of ['00000000-0000-0000-0000-000000000001', 'B-0001', 'T-', 'T-abc']) {
    assert.throws(() => shellViewSelection({ ...selected('brand'), tenant: { state: 'resolved', value: value as TenantCode } }), /INVALID_PRODUCT_SCOPE_CODE/);
  }
});
test('unresolved location never silently means all locations', () => {
  assert.throws(() => shellViewSelection({ ...selected('brand'), location: { state: 'unresolved' } }), /PRODUCT_SCOPE_UNRESOLVED/);
});
test('scope carries no identity, PII, permissions or action grant', () => {
  const scope = selected('platform');
  assert.deepEqual(Object.keys(scope).sort(), ['audience', 'brand', 'location', 'pack', 'residency', 'role', 'tenant', 'version']);
  assert.deepEqual(Object.keys(shellViewSelection(scope)).sort(), ['audience', 'brand', 'location', 'tenant']);
});
test('audiences have distinct navigation contracts, not a Brand child in Platform', () => {
  assert.deepEqual(SHELL_NAVIGATION.platform, ['Home', 'My work', 'Tenants', 'Capabilities', 'Sending health', 'Providers', 'Approvals', 'Safety', 'Audit']);
  assert.deepEqual(SHELL_NAVIGATION.brand, ['Home', 'My work', 'Customers', 'Communications', 'Growth', 'Knowledge', 'Settings']);
  assert.equal((SHELL_NAVIGATION.platform as readonly string[]).includes('Customers'), false);
});
