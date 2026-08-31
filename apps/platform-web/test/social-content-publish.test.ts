import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

test('social.content_publish table and blueprint are seeded, RLS-forced, decision-gated', () => {
  const migration = read('../../infra/db/migrations/0057_social_content_publish.sql');
  assert.match(migration, /CREATE TABLE platform\.social_content_items/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /blueprint_key/);
  assert.match(migration, /workflow_instance_id/);
  assert.match(migration, /stage_key/);
  assert.match(migration, /social\.content_publish/);
  assert.match(migration, /BRAND_REVIEW/);
  assert.match(migration, /brand_approver/);
  assert.match(migration, /decisionRequired.: true/);
});

test('social content vertical is registered and routes use the factory', () => {
  const verticals = read('lib/verticals.ts');
  assert.match(verticals, /SOCIAL_CONTENT_WORKFLOW/);
  assert.match(verticals, /social\.content_publish/);
  assert.match(verticals, /SUBJECT_TABLES/);

  const workflowRoute = read('app/api/social-content/[id]/workflow/route.ts');
  const decisionRoute = read('app/api/social-content/[id]/workflow/decision/route.ts');
  assert.match(workflowRoute, /createVerticalWorkflowRoute\(SOCIAL_CONTENT_WORKFLOW\)/);
  assert.match(decisionRoute, /createVerticalDecisionRoute\(SOCIAL_CONTENT_WORKFLOW\)/);
});
