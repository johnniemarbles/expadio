import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(
  new URL('../app/api/internal/domain-events/run/route.ts', import.meta.url),
  'utf8',
);
const auth = readFileSync(
  new URL('../lib/internal-worker-auth.ts', import.meta.url),
  'utf8',
);

test('internal runner route is machine-authenticated and tenant scoped', () => {
  assert.match(route, /authenticateInternalWorkerRequest/);
  assert.match(auth, /x-expadio-tenant-id/);
  assert.match(route, /runDomainEventActionWorkerBatch/);
  assert.doesNotMatch(route, /resolveRequestContext/);
  assert.doesNotMatch(route, /auth\(\)/);
});

test('runner route bounds work per invocation', () => {
  assert.match(route, /const DEFAULT_LIMIT = 10/);
  assert.match(route, /const MAX_LIMIT = 100/);
  assert.match(route, /Math\.min\(value as number, MAX_LIMIT\)/);
  assert.match(route, /INTERNAL_WORKER_LIMIT_INVALID/);
});

test('runner route binds and resets session tenant context', () => {
  assert.match(route, /set_config\('app\.tenant_id', \$1, false\)/);
  assert.match(route, /RESET app\.tenant_id/);
  assert.match(route, /client\.release\(true\)/);
  assert.match(route, /client\?\.release\(\)/);
});
