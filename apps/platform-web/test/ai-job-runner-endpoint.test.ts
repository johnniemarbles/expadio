import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(
  new URL('../app/api/internal/ai-jobs/run/route.ts', import.meta.url),
  'utf8',
);
const auth = readFileSync(
  new URL('../lib/internal-worker-auth.ts', import.meta.url),
  'utf8',
);

test('AI worker endpoint is machine authenticated and tenant scoped', () => {
  assert.match(route, /authenticateInternalWorkerRequest/);
  assert.match(auth, /x-expadio-tenant-id/);
  assert.match(route, /EXPADIO_AI_WORKER_SUBJECT_ID/);
  assert.match(route, /runAiJobWorkerOnce/);
  assert.doesNotMatch(route, /resolveRequestContext/);
  assert.doesNotMatch(route, /auth\(\)/);
});

test('AI worker endpoint is disabled without configured service identity', () => {
  assert.match(route, /AI_WORKER_IDENTITY_DISABLED/);
  assert.match(route, /serviceSubjectId === ''/);
  assert.match(route, /status: error\.status/);
});

test('AI worker endpoint bounds work per invocation', () => {
  assert.match(route, /const DEFAULT_LIMIT = 5/);
  assert.match(route, /const MAX_LIMIT = 25/);
  assert.match(route, /Math\.min\(value as number, MAX_LIMIT\)/);
  assert.match(route, /INTERNAL_WORKER_LIMIT_INVALID/);
});

test('AI worker endpoint binds and safely resets tenant session context', () => {
  assert.match(route, /set_config\('app\.tenant_id', \$1, false\)/);
  assert.match(route, /RESET app\.tenant_id/);
  assert.match(route, /client\.release\(true\)/);
  assert.match(route, /client\?\.release\(\)/);
});
