import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const activities = read('../app/api/leads/capture/[id]/activities/route.ts');
const tasks = read('../app/api/leads/capture/[id]/tasks/route.ts');
const taskUpdate = read('../app/api/leads/tasks/[taskId]/route.ts');

test('activity + task endpoints are organization-governed', () => {
  for (const route of [activities, tasks, taskUpdate]) {
    assert.match(route, /resolveBrandContext/);
    assert.match(route, /ORGANIZATION_CONTEXT_REQUIRED/);
  }
  // Mutations require brand governance.
  for (const route of [tasks, taskUpdate]) {
    assert.match(route, /hasBrandGovernanceForOrganization/);
  }
  assert.match(activities, /hasBrandGovernanceForOrganization/); // POST note
});

test('notes are authored as NOTE activities anchored to an in-scope lead', () => {
  assert.match(activities, /activity_type = 'NOTE'|'NOTE'/);
  assert.match(activities, /FROM platform\.lead_capture_leads[\s\S]*organization_id = \$2::uuid/);
});

test('task completion stamps completed_at only when DONE', () => {
  assert.match(taskUpdate, /CASE WHEN \$4 = 'DONE' THEN now\(\) ELSE NULL END/);
});
