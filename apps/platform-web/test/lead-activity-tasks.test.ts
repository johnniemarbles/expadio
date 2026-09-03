import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../../infra/db/migrations/0143_lead_activity_tasks.sql');
const ingress = read('../app/api/lead-capture/public/[sourceId]/route.ts');

test('activity timeline is append-only, org-scoped, and notes require a body', () => {
  assert.match(migration, /CREATE TABLE platform\.lead_activities/);
  assert.match(migration, /lead_activities_append_only/);
  assert.match(migration, /activity_type <> 'NOTE' OR btrim\(coalesce\(body, ''\)\) <> ''/);
  assert.match(migration, /lead_activities_organization_isolation[\s\S]*current_context_can_access_organization/);
  // Ingress may only append SYSTEM entries, never notes.
  assert.match(migration, /activity_type = 'SYSTEM' AND platform\.current_public_capture_source_scope/);
});

test('tasks carry assignee/due/status with a completed-shape guard', () => {
  assert.match(migration, /CREATE TABLE platform\.lead_tasks/);
  assert.match(migration, /status text NOT NULL DEFAULT 'OPEN' CHECK \(status IN \('OPEN','DONE','CANCELLED'\)\)/);
  assert.match(migration, /lead_task_completed_shape CHECK \(status <> 'DONE' OR completed_at IS NOT NULL\)/);
});

test('capture opens the timeline with a system entry, best-effort', () => {
  assert.match(ingress, /INSERT INTO platform\.lead_activities/);
  assert.match(ingress, /'SYSTEM'/);
  assert.match(ingress, /Capture activity log skipped/);
});
