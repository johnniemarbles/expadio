import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../../../infra/db/migrations/0092_learning_enrollment_progress.sql');
const runtime = read('../../../packages/postgres-runtime/src/learning-enrollment.ts');
const learners = read('../app/api/learning/learners/route.ts');
const enrollments = read('../app/api/learning/enrollments/route.ts');
const mine = read('../app/api/learning/me/enrollments/route.ts');
const complete = read('../app/api/learning/me/enrollments/[id]/lessons/[lessonId]/complete/route.ts');
const transcript = read('../app/api/learning/me/transcript/route.ts');
const context = read('../lib/request-context.ts');

test('learner administration is tenant-contextual and admin-only', () => {
  for (const source of [learners, enrollments]) {
    assert.match(source, /resolveRequestContext\(request\)/);
    assert.match(source, /withTenantTransaction/);
    assert.match(source, /hasLearningAuthoringRole/);
  }
});

test('learner self-service binds both subject and verified issuer', () => {
  assert.match(context, /readonly issuer: string \| null/);
  assert.match(context, /issuer: effective\.issuer \?\? null/);
  for (const source of [mine, complete, transcript]) {
    assert.match(source, /subjectId: context\.subjectId/);
    assert.match(source, /subjectIssuer: context\.issuer/);
    assert.doesNotMatch(source, /hasLearningAuthoringRole/);
  }
  assert.match(runtime, /subject_issuer IS NOT DISTINCT FROM \$3/);
});

test('enrollment pins immutable published course version at the database layer', () => {
  assert.match(migration, /new learning enrollments must pin a published course version/);
  assert.match(migration, /learning enrollment identity and pinned version are immutable/);
  assert.match(migration, /FOREIGN KEY \(course_version_id, tenant_id, course_id\)/);
  assert.match(migration, /FOREIGN KEY \(lesson_id, tenant_id, course_version_id\)/);
});

test('tenant learning records use FORCE RLS', () => {
  for (const table of [
    'learning_learners',
    'learning_enrollments',
    'learning_lesson_progress',
  ]) {
    assert.match(migration, new RegExp('ALTER TABLE platform\\.' + table + ' FORCE ROW LEVEL SECURITY'));
  }
});

test('completion uses the existing domain-event outbox and replay guards', () => {
  assert.match(runtime, /appendDomainEventWithOutbox/);
  assert.match(runtime, /learning\.enrollment\.created/);
  assert.match(runtime, /learning\.course\.started/);
  assert.match(runtime, /learning\.lesson\.completed/);
  assert.match(runtime, /learning\.course\.completed/);
  assert.match(runtime, /LEARNING_ASSIGNMENT_KEY_CONFLICT/);
  assert.match(runtime, /idempotent: true/);
});
