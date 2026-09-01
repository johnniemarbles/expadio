import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../../../infra/db/migrations/0090_tenant_product_modules_learning.sql');
const runtime = read('../../../packages/postgres-runtime/src/product-module.ts');
const catalogRoute = read('../app/api/tenant/modules/route.ts');
const activationRoute = read('../app/api/tenant/modules/[key]/activate/route.ts');
const learningContextRoute = read('../app/api/learning/context/route.ts');

test('module persistence separates catalog, entitlement, installation, and learning config', () => {
  assert.match(migration, /CREATE TABLE platform\.product_modules/);
  assert.match(migration, /CREATE TABLE platform\.tenant_module_entitlements/);
  assert.match(migration, /CREATE TABLE platform\.tenant_modules/);
  assert.match(migration, /CREATE TABLE platform\.learning_tenant_settings/);
  assert.match(migration, /CREATE TABLE platform\.learning_academies/);
  assert.match(migration, /source_type IN \('PLAN','ADD_ON','TRIAL','CONTRACT','PLATFORM_GRANT'\)/);
});

test('tenant-owned module and learning data are FORCE RLS protected', () => {
  for (const table of [
    'tenant_module_entitlements',
    'tenant_modules',
    'learning_tenant_settings',
    'learning_academies',
  ]) {
    assert.match(migration, new RegExp(`ALTER TABLE platform\\.${table} FORCE ROW LEVEL SECURITY`));
    assert.match(
      migration,
      new RegExp(`tenant_id = platform\\.current_tenant_id\\(\\)`),
    );
  }
});

test('activation is tenant-contextual, admin-governed, and cannot mint entitlement', () => {
  assert.match(activationRoute, /resolveRequestContext\(request\)/);
  assert.match(activationRoute, /withTenantTransaction/);
  assert.match(activationRoute, /hasGovernanceWriteRole/);
  assert.match(activationRoute, /activateLearningModule/);
  assert.doesNotMatch(activationRoute, /INSERT INTO platform\.tenant_module_entitlements/);
  assert.doesNotMatch(catalogRoute, /INSERT INTO platform\.tenant_module_entitlements/);
});

test('learning provisioning is idempotent and uses the existing domain-event outbox', () => {
  assert.match(runtime, /assertTenantModuleActivationAllowed/);
  assert.match(runtime, /ON CONFLICT \(tenant_id, module_key\) DO NOTHING/);
  assert.match(runtime, /ON CONFLICT \(tenant_id\) DO NOTHING/);
  assert.match(runtime, /ON CONFLICT \(tenant_id, slug\) DO NOTHING/);
  assert.match(runtime, /appendDomainEventWithOutbox/);
  assert.match(runtime, /eventType: 'tenant\.module\.activated'/);
  assert.match(runtime, /provisioner: 'learning\.v1'/);
});

test('learning reads are server-side gated by entitlement plus active installation', () => {
  assert.match(learningContextRoute, /loadLearningTenantContext/);
  assert.match(runtime, /requireTenantModuleOperational/);
  assert.match(runtime, /MODULE_LOCKED_BY_PLAN/);
  assert.match(learningContextRoute, /Cache-Control': 'private, no-store'/);
});
