import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(
  new URL('../app/api/internal/domain-events/run-many/route.ts', import.meta.url),
  'utf8',
);
const runner = readFileSync(
  new URL('../lib/domain-event-multi-tenant-runner.ts', import.meta.url),
  'utf8',
);

test('run-many is machine authenticated and never performs tenant discovery', () => {
  assert.match(route, /authenticateInternalWorkerToken/);
  assert.match(route, /parseInternalWorkerTenantId/);
  assert.match(route, /tenantIds/);
  assert.doesNotMatch(route, /SELECT .*platform\.tenants/i);
  assert.doesNotMatch(runner, /SELECT .*platform\.tenants/i);
});

test('run-many has tenant, per-tenant, and total work ceilings', () => {
  assert.match(route, /const MAX_TENANTS = 50/);
  assert.match(route, /const MAX_PER_TENANT_LIMIT = 100/);
  assert.match(route, /const MAX_TOTAL_ITEMS = 500/);
  assert.match(route, /tenantIds\.length \* perTenantLimit > MAX_TOTAL_ITEMS/);
  assert.match(route, /INTERNAL_WORKER_DUPLICATE_TENANT/);
});

test('multi-tenant runtime binds and resets each tenant independently', () => {
  assert.match(runner, /set_config\('app\.tenant_id', \$1, false\)/);
  assert.match(runner, /RESET app\.tenant_id/);
  assert.match(runner, /client\.release\(true\)/);
  assert.match(runner, /for \(const tenantId of input\.tenantIds\)/);
});


test('tenant execution matures scheduled governed actions under the same tenant lease', () => {
  assert.match(runner, /acquireTenantExecutionLease/);
  assert.match(runner, /runDomainEventActionWorkerBatch/);
  assert.match(runner, /runScheduledGovernedActionWorkerBatch/);
  assert.match(runner, /finishTenantExecutionRun/);
});
