import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../../../infra/db/migrations/0150_learning_assignment_submission.sql', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../src/learning-assignment.ts', import.meta.url), 'utf8');

test('assignment truth is versioned, tenant isolated and grading evidence is append-only', () => {
  for (const table of [
    'learning_assignments','learning_assignment_versions','learning_assignment_submissions',
    'learning_assignment_submission_assets','learning_assignment_grade_events',
  ]) {
    assert.match(migration, new RegExp(`ALTER TABLE platform\\.%I FORCE ROW LEVEL SECURITY`));
    assert.match(migration, new RegExp(`'${table}'`));
  }
  assert.match(migration, /learning_assignment_versions_lifecycle/);
  assert.match(migration, /assignment grade events are append-only/);
  assert.match(migration, /learning_assignment_grade_shape/);
});

test('learner submission binds authenticated identity, enrollment version, lesson block and prerequisites', () => {
  assert.match(runtime, /learner\.subject_id = \$3/);
  assert.match(runtime, /learner\.subject_issuer IS NOT DISTINCT FROM \$4/);
  assert.match(runtime, /lesson\.course_version_id = enrollment\.course_version_id/);
  assert.match(runtime, /block->>'type' = 'ASSIGNMENT'/);
  assert.match(runtime, /block->'data'->>'definitionId' = assignment\.assignment_key/);
  assert.match(runtime, /prior\.required = true/);
  assert.match(runtime, /progress\.status = 'COMPLETED'/);
  assert.match(runtime, /learning\.assignment\.submitted/);
});

test('manual grading is row locked, bounded and emits durable evidence', () => {
  assert.match(runtime, /FOR UPDATE OF submission/);
  assert.match(runtime, /score > maxPoints/);
  assert.match(runtime, /learning_assignment_grade_events/);
  assert.match(runtime, /learning\.assignment\.graded/);
  assert.match(runtime, /learning\.assignment\.returned/);
  assert.match(runtime, /appendDomainEventWithOutbox/);
});
