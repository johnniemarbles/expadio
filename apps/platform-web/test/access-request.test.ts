import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const migration = read('../../../infra/db/migrations/0056_access_request.sql');

test('the access.request table and blueprint are seeded, RLS-forced, decision-gated', () => {
  assert.match(migration, /CREATE TABLE platform\.access_requests/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /tenant_id = platform\.current_tenant_id\(\)/);
  assert.match(migration, /NULL, 'access\.request', 1/);
  assert.match(migration, /"stageKey": "SECURITY_REVIEW"/);
  assert.match(migration, /"requiredParticipantKeys": \["security_reviewer"\]/);
  assert.match(migration, /"decisionRequired": true/);
});
