import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runner = readFileSync(
  new URL('../lib/domain-event-multi-tenant-runner.ts', import.meta.url),
  'utf8',
);
const execution = readFileSync(
  new URL('../lib/domain-event-tenant-execution.ts', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL('../../../infra/db/migrations/0068_domain_event_tenant_execution.sql', import.meta.url),
  'utf8',
);

test('multi-tenant ticks have invocation and tenant run identities', () => {
  assert.match(runner, /invocationId/);
  assert.match(runner, /runId/);
  assert.match(runner, /startedAt/);
  assert.match(runner, /finishedAt/);
  assert.match(runner, /durationMs/);
  assert.match(runner, /skippedTenants/);
  assert.match(runner, /leaseLostTenants/);
});

test('tenant execution lease prevents overlap and terminalizes expired runs', () => {
  assert.match(execution, /FOR UPDATE/);
  assert.match(execution, /reason: 'BUSY'/);
  assert.match(execution, /reason: 'DISABLED'/);
  assert.match(execution, /TENANT_EXECUTION_LEASE_EXPIRED/);
  assert.match(execution, /status = 'LEASE_LOST'/);
  assert.match(execution, /current_run_id = NULL/);
  assert.match(execution, /lease_token = NULL/);
});

test('scheduler metadata is RLS-protected orchestration state, not another queue', () => {
  assert.match(migration, /domain_event_tenant_execution_runs/);
  assert.match(migration, /domain_event_tenant_execution_state/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /next_scheduled_at/);
  assert.doesNotMatch(migration, /payload jsonb/i);
  assert.doesNotMatch(migration, /topic text/i);
});
