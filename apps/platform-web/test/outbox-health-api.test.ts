import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const helper = read('../lib/outbox-health-summary.ts');
const route = read('../app/api/outbox/health/route.ts');

test('outbox health helper reads only the tenant-scoped health view', () => {
  assert.match(helper, /listOutboxHealthSummary/);
  assert.match(helper, /FROM platform\.outbox_health_summary/);
  assert.match(helper, /tenant_id = \$1::uuid/);
  assert.match(helper, /health_key = \$\$\{params\.length\}/);
  assert.match(helper, /ORDER BY CASE health_status/);
  assert.doesNotMatch(helper, /UPDATE platform\./);
  assert.doesNotMatch(helper, /DELETE FROM platform\./);
  assert.doesNotMatch(helper, /INSERT INTO platform\./);
});

test('outbox health route is governed, tenant-scoped, and read-only', () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /withTenantClient/);
  assert.match(route, /listOutboxHealthSummary/);
  assert.match(route, /healthKey/);
  assert.match(route, /Unsupported outbox health key/);
  assert.doesNotMatch(route, /export async function POST/);
  assert.doesNotMatch(route, /claim/i);
  assert.doesNotMatch(route, /publish/i);
  assert.doesNotMatch(route, /retry/i);
  assert.doesNotMatch(route, /recover/i);
});

test('outbox health key vocabulary covers the P0 outbox rollups', () => {
  for (const required of [
    'domain_event_outbox_ready_backlog',
    'domain_event_outbox_retry_due',
    'domain_event_outbox_future_retry',
    'domain_event_outbox_stale_claims',
    'domain_event_outbox_dead',
  ]) {
    assert.match(helper, new RegExp(required));
  }
});
