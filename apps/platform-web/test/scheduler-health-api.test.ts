import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const helper = read('../lib/scheduler-health-summary.ts');
const route = read('../app/api/scheduler/health/route.ts');

test('scheduler health helper reads only the tenant-scoped health view', () => {
  assert.match(helper, /listSchedulerHealthSummary/);
  assert.match(helper, /FROM platform\.scheduler_health_summary/);
  assert.match(helper, /tenant_id = \$1::uuid/);
  assert.match(helper, /health_key = \$\$\{params\.length\}/);
  assert.match(helper, /ORDER BY CASE health_status/);
  assert.doesNotMatch(helper, /UPDATE platform\./);
  assert.doesNotMatch(helper, /DELETE FROM platform\./);
  assert.doesNotMatch(helper, /INSERT INTO platform\./);
});

test('scheduler health route is governed, tenant-scoped, and read-only', () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /withTenantClient/);
  assert.match(route, /listSchedulerHealthSummary/);
  assert.match(route, /healthKey/);
  assert.match(route, /Unsupported scheduler health key/);
  assert.doesNotMatch(route, /export async function POST/);
  assert.doesNotMatch(route, /claim/i);
  assert.doesNotMatch(route, /retry/i);
  assert.doesNotMatch(route, /recover/i);
});

test('scheduler health key vocabulary covers the P0 scheduler rollups', () => {
  for (const required of [
    'scheduler_targets_due',
    'scheduler_targets_disabled',
    'scheduler_execution_expired_leases',
    'scheduler_execution_failed_runs',
    'scheduler_scheduled_actions_due_unmaterialized',
  ]) {
    assert.match(helper, new RegExp(required));
  }
});
