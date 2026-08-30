import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const helper = read('../lib/communication-health-summary.ts');
const route = read('../app/api/communications/health/route.ts');

test('communication health helper reads only the tenant-scoped health view', () => {
  assert.match(helper, /listCommunicationHealthSummary/);
  assert.match(helper, /FROM platform\.communication_health_summary/);
  assert.match(helper, /tenant_id = \$1::uuid/);
  assert.match(helper, /health_key = \$\$\{params\.length\}/);
  assert.match(helper, /ORDER BY CASE health_status/);
  assert.doesNotMatch(helper, /UPDATE platform\./);
  assert.doesNotMatch(helper, /DELETE FROM platform\./);
  assert.doesNotMatch(helper, /INSERT INTO platform\./);
});

test('communication health route is governed, tenant-scoped, and read-only', () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /withTenantClient/);
  assert.match(route, /listCommunicationHealthSummary/);
  assert.match(route, /healthKey/);
  assert.match(route, /Unsupported communication health key/);
  assert.doesNotMatch(route, /export async function POST/);
  assert.doesNotMatch(route, /claim/i);
  assert.doesNotMatch(route, /retry/i);
  assert.doesNotMatch(route, /recover/i);
});

test('communication health key vocabulary covers the P0 communication rollups', () => {
  for (const required of [
    'communication_deliveries_in_flight',
    'communication_deliveries_stuck_pending',
    'communication_deliveries_expired_claims',
    'communication_deliveries_negative_terminal',
    'communication_provider_attempt_failures',
    'communication_provider_webhooks_negative',
    'communication_provider_webhooks_unmatched',
  ]) {
    assert.match(helper, new RegExp(required));
  }
});
