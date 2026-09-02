import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const activity = read('../app/api/activity/route.ts');
const auditPage = read('../app/(shell)/audit/page.tsx');
const sessions = read('../app/api/sessions/route.ts');
const migrate = read('../scripts/migrate.mjs');
const migration = read('../../../infra/db/migrations/0113_audit_organization_provenance.sql');

test('activity uses live request context and never invents fixture evidence', () => {
  assert.match(activity, /resolveRequestContext\(request\)/);
  assert.match(activity, /withTenantTransaction\(context/);
  assert.match(activity, /organization_id = \$2/);
  assert.doesNotMatch(activity, /00000000-0000-0000-0000-000000000001/);
  assert.doesNotMatch(activity, /00000000-0000-0000-0000-000000000002/);
  assert.doesNotMatch(activity, /activity_live_1|activity_live_2|Policy handbook|provisioned membership/);
  assert.match(auditPage, /No governed events exist in the active workspace yet/);
});

test('organization provenance is forward-only and compatible with immutable history', () => {
  assert.match(migration, /ADD COLUMN organization_id uuid/);
  assert.doesNotMatch(migration, /UPDATE platform\.agent_runs|UPDATE platform\.agent_run_events|UPDATE platform\.sensitive_read_events/);
  assert.doesNotMatch(migration, /ON DELETE SET NULL/);
  assert.match(migration, /current_organization_id_nullable/);
});

test('agent event organization is inherited from the parent run and conflicting ambient scope is rejected', () => {
  assert.match(migration, /SELECT organization_id[\s\S]*FROM platform\.agent_runs/);
  assert.match(migration, /parent_organization <> ambient_organization/);
  assert.match(migration, /NEW\.organization_id := parent_organization/);
});

test('sessions writer uses live context so database defaults receive app.organization_id', () => {
  assert.match(sessions, /resolveRequestContext\(request\)/);
  assert.match(sessions, /withTenantTransaction\(context/);
  assert.match(sessions, /context\.subjectId/);
  assert.doesNotMatch(sessions, /00000000-0000-0000-0000-000000000001/);
  assert.doesNotMatch(sessions, /00000000-0000-0000-0000-000000000002/);
});

test('legacy migration reconciliation stops at the execution-artifacts sentinel generation', () => {
  assert.match(migrate, /reconciliationCeiling = '0100_execution_artifacts\.sql'/);
  assert.match(migrate, /if \(file > reconciliationCeiling\) break/);
  assert.match(migrate, /platform\.execution_artifacts/);
  assert.doesNotMatch(migrate, /for \(const file of files\) \{\s*await client\.query\('INSERT INTO public\.schema_migrations/);
});
