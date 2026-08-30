import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const helper = read('../lib/business-execution-trace.ts');
const route = read('../app/api/execution/trace/route.ts');

test('business execution trace helper reads the tenant-scoped trace view', () => {
  assert.match(helper, /listBusinessExecutionTrace/);
  assert.match(helper, /FROM platform\.business_execution_trace/);
  assert.match(helper, /tenant_id = \$1::uuid/);
  assert.match(helper, /root_event_id = \$\$\{params\.length\}::uuid/);
  assert.match(helper, /correlation_id = \$\$\{params\.length\}/);
  assert.match(helper, /aggregate_type = \$\$\{params\.length\}/);
  assert.match(helper, /aggregate_id = \$\$\{params\.length\}/);
  assert.match(helper, /LIMIT \$\$\{params\.length\}/);
});

test('business execution trace route is governed and bounded', () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /withTenantClient/);
  assert.match(route, /listBusinessExecutionTrace/);
  assert.match(route, /eventId/);
  assert.match(route, /correlationId/);
  assert.match(route, /aggregateType/);
  assert.match(route, /aggregateId/);
  assert.match(route, /Provide eventId, correlationId, or aggregateType \+ aggregateId/);
  assert.match(route, /aggregateType and aggregateId must be supplied together/);
});
