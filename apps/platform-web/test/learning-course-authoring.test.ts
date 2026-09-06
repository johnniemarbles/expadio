import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const collection = read('../app/api/learning/courses/route.ts');
const version = read('../app/api/learning/courses/[id]/versions/[version]/route.ts');
const clone = read('../app/api/learning/courses/[id]/versions/route.ts');
const publish = read('../app/api/learning/courses/[id]/versions/[version]/publish/route.ts');
const migration = read('../../../infra/db/migrations/0091_learning_course_authoring.sql');
const runtime = read('../../../packages/postgres-runtime/src/learning.ts');

test('authoring routes require tenant context and admin authority', () => {
  for (const source of [collection, version, clone, publish]) {
    assert.match(source, /resolveRequestContext\(request\)/);
    assert.match(source, /withTenantTransaction/);
    assert.match(source, /hasLearningAuthoringRole/);
    assert.match(source, /private, no-store/);
  }
});

test('course content is versioned rather than edited in place after publication', () => {
  assert.match(migration, /CREATE TABLE platform\.learning_course_versions/);
  assert.match(migration, /CREATE TABLE platform\.learning_course_modules/);
  assert.match(migration, /CREATE TABLE platform\.learning_lessons/);
  assert.match(migration, /non-draft learning course versions are immutable/);
  assert.match(migration, /may mutate only while course version is DRAFT/);
  assert.match(runtime, /enrollmentMode: version\.enrollment_mode/);
  assert.match(runtime, /certificateEnabled: version\.certificate_enabled/);
  assert.match(runtime, /passingScore: version\.passing_score/);
  assert.match(runtime, /clonePublishedLearningCourseVersion/);
  assert.match(runtime, /state = 'SUPERSEDED'/);
});

test('publication is validated in both domain/runtime and Postgres', () => {
  assert.match(runtime, /assertCoursePublishable/);
  assert.match(migration, /require learning objectives/);
  assert.match(migration, /require at least one module/);
  assert.match(migration, /require at least one lesson/);
});

test('course lifecycle uses existing Domain Event outbox', () => {
  assert.match(runtime, /appendDomainEventWithOutbox/);
  assert.match(runtime, /learning\.course\.created/);
  assert.match(runtime, /learning\.course\.version\.drafted/);
  assert.match(runtime, /learning\.course\.version\.published/);
});
