import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const coordinator = readFileSync(
  new URL('../lib/domain-event-tenant-coordinator.ts', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL('../../../infra/db/migrations/0069_domain_event_scheduler_targets.sql', import.meta.url),
  'utf8',
);
const route = readFileSync(
  new URL('../app/api/internal/domain-events/run-due/route.ts', import.meta.url),
  'utf8',
);

test('scheduler target registry is explicit control-plane metadata, not tenant discovery', () => {
  assert.match(migration, /domain_event_scheduler_targets/);
  assert.match(migration, /execution_enabled boolean/);
  assert.match(migration, /cadence_seconds/);
  assert.match(migration, /next_scheduled_at/);
  assert.doesNotMatch(coordinator, /FROM platform\.tenants/i);
  assert.doesNotMatch(migration, /payload jsonb/i);
  assert.doesNotMatch(migration, /event_type/i);
});

test('coordinator selects only explicitly enabled due targets', () => {
  assert.match(coordinator, /execution_enabled = true/);
  assert.match(coordinator, /next_scheduled_at <= \$1/);
  assert.match(coordinator, /ORDER BY next_scheduled_at ASC/);
  assert.match(coordinator, /runDomainEventActionWorkerForTenants/);
});

test('busy overlap does not advance tenant schedule', () => {
  assert.match(coordinator, /SKIPPED_BUSY/);
  const busyBlock = coordinator.slice(
    coordinator.indexOf("if (result.status === 'SKIPPED_BUSY')"),
    coordinator.indexOf('continue;', coordinator.indexOf("if (result.status === 'SKIPPED_BUSY')")),
  );
  assert.doesNotMatch(busyBlock, /next_scheduled_at/);
});

test('run-due remains machine authenticated and bounded', () => {
  assert.match(route, /authenticateInternalWorkerToken/);
  assert.match(route, /MAX_TENANTS = 50/);
  assert.match(route, /MAX_TOTAL_ITEMS = 500/);
  assert.match(route, /runDueTenantExecutionCoordinator/);
});
