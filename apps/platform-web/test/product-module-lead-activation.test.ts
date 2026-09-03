import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const route = read('../app/api/tenant/modules/[key]/activate/route.ts');
const runtime = read('../../../packages/postgres-runtime/src/simple-product-module-activation.ts');

test('Lead Management uses the governed tenant module activation endpoint', () => {
  assert.match(route, /moduleKey !== 'learning' && moduleKey !== 'lead-management'/);
  assert.match(route, /activateSimpleProductModule/);
  assert.match(route, /hasGovernanceWriteRole/);
});

test('simple activation consumes entitlement state and never mints entitlement', () => {
  assert.match(runtime, /loadTenantProductModule/);
  assert.match(runtime, /assertTenantModuleActivationAllowed/);
  assert.match(runtime, /INSERT INTO platform\.tenant_modules/);
  assert.doesNotMatch(runtime, /INSERT INTO platform\.tenant_module_entitlements/);
});

test('simple activation emits the same tenant module activation domain event', () => {
  assert.match(runtime, /appendDomainEventWithOutbox/);
  assert.match(runtime, /tenant\.module\.activated/);
  assert.match(runtime, /tenant\.module\.simple-activation/);
});
