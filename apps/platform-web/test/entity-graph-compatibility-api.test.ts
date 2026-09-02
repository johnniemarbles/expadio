import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(
  new URL('../app/api/enterprise/graph/compatibility/route.ts', import.meta.url),
  'utf8',
);

test('graph compatibility API is authenticated and tenant-transaction scoped', () => {
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /withTenantTransaction\(context/);
  assert.match(route, /ORGANIZATION_CONTEXT_REQUIRED/);
  assert.match(route, /context\.tenantId/);
  assert.match(route, /Cache-Control': 'private, no-store'/);
});

test('graph compatibility API exposes proof and rollback state', () => {
  assert.match(route, /entity_graph_reads_enabled/);
  assert.match(route, /compare_operational_graph_to_legacy/);
  assert.match(route, /rollbackMode: !graphReadsEnabled/);
  assert.match(route, /driftFree: drift\.rows\.length === 0/);
  assert.match(route, /GRAPH_ONLY.*LEGACY_ONLY.*DEPTH_MISMATCH/s);
});

test('graph drift details are bounded', () => {
  assert.match(route, /LIMIT 100/);
});
