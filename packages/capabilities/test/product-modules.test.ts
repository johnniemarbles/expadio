import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertTenantModuleActivationAllowed,
  canActivateTenantModule,
  isTenantModuleOperational,
  resolveTenantModuleAvailability,
} from '../src/product-modules.ts';

test('entitled but not installed is ready to activate', () => {
  const state = resolveTenantModuleAvailability({
    moduleEnabled: true,
    entitlementActive: true,
    installationState: null,
  });
  assert.equal(state, 'READY_TO_ACTIVATE');
  assert.equal(canActivateTenantModule(state), true);
});

test('a tenant cannot self-activate a module without an entitlement', () => {
  const state = resolveTenantModuleAvailability({
    moduleEnabled: true,
    entitlementActive: false,
    installationState: null,
  });
  assert.equal(state, 'LOCKED_BY_PLAN');
  assert.throws(() => assertTenantModuleActivationAllowed(state), /MODULE_LOCKED_BY_PLAN/);
});

test('loss of entitlement suspends effective access without deleting installation state', () => {
  const state = resolveTenantModuleAvailability({
    moduleEnabled: true,
    entitlementActive: false,
    installationState: 'ACTIVE',
  });
  assert.equal(state, 'SUSPENDED');
  assert.equal(isTenantModuleOperational(state), false);
});

test('active module is operational and activation is idempotently acceptable', () => {
  const state = resolveTenantModuleAvailability({
    moduleEnabled: true,
    entitlementActive: true,
    installationState: 'ACTIVE',
  });
  assert.equal(state, 'ACTIVE');
  assert.equal(isTenantModuleOperational(state), true);
  assert.doesNotThrow(() => assertTenantModuleActivationAllowed(state));
});

test('deactivated or failed installations can be reactivated after entitlement returns', () => {
  for (const installationState of ['DEACTIVATED', 'PROVISIONING_FAILED'] as const) {
    const state = resolveTenantModuleAvailability({
      moduleEnabled: true,
      entitlementActive: true,
      installationState,
    });
    assert.equal(canActivateTenantModule(state), true);
  }
});
