import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const helper = read('../lib/execution-health-summary.ts');
const route = read('../app/api/execution/health/route.ts');

test('execution health helper reads only the tenant-scoped health view', () => {
  assert.match(helper, /listExecutionHealthSummary/);
  assert.match(helper, /FROM platform\.execution_health_summary/);
  assert.match(helper, /tenant_id = \$1::uuid/);
  assert.match(helper, /health_key = \$\$\{params\.length\}/);
  assert.match(helper, /ORDER BY CASE health_status/);
  assert.doesNotMatch(helper, /UPDATE platform\./);
  assert.doesNotMatch(helper, /DELETE FROM platform\./);
  assert.doesNotMatch(helper, /INSERT INTO platform\./);
});

test('execution health route is governed, tenant-scoped, and read-only', () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /withTenantClient/);
  assert.match(route, /listExecutionHealthSummary/);
  assert.match(route, /healthKey/);
  assert.match(route, /Unsupported execution health key/);
  assert.doesNotMatch(route, /export async function POST/);
  assert.doesNotMatch(route, /claim/i);
  assert.doesNotMatch(route, /retry/i);
  assert.doesNotMatch(route, /recover/i);
});

test('execution health key vocabulary covers the P0 operations rollups', () => {
  for (const required of [
    'domain_event_outbox_unpublished',
    'governed_action_failed_attempts',
    'scheduled_actions_due_unmaterialized',
    'communication_deliveries_open',
    'communication_provider_webhooks_unmatched',
  ]) {
    assert.match(helper, new RegExp(required));
  }
});
