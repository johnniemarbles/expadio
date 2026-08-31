import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../../../infra/db/migrations/0093_learning_assessment_core.sql');
const runtime = read('../../../packages/postgres-runtime/src/learning-assessment.ts');
const admin = read('../app/api/learning/assessments/route.ts');
const questionBanks = read('../app/api/learning/question-banks/route.ts');
const mine = read('../app/api/learning/me/assessments/route.ts');
const start = read('../app/api/learning/me/assessments/[id]/attempts/route.ts');
const submit = read('../app/api/learning/me/assessment-attempts/[attemptId]/submit/route.ts');

test('assessment authoring is tenant-contextual and admin-only', () => {
  for (const source of [admin, questionBanks]) {
    assert.match(source, /resolveRequestContext\(request\)/);
    assert.match(source, /withTenantTransaction/);
    assert.match(source, /hasLearningAuthoringRole/);
  }
});

test('learner assessment routes bind authenticated subject and issuer without admin override', () => {
  for (const source of [mine, start, submit]) {
    assert.match(source, /subjectId: context\.subjectId/);
    assert.match(source, /subjectIssuer: context\.issuer \?\? null/);
    assert.doesNotMatch(source, /hasLearningAuthoringRole/);
  }
});

test('learner attempt projection does not expose answer keys or explanations', () => {
  const projectionStart = runtime.indexOf('async function loadAttemptProjection');
  const projectionEnd = runtime.indexOf('export async function submitMyAssessmentAttempt');
  const projection = runtime.slice(projectionStart, projectionEnd);
  assert.ok(projectionStart >= 0 && projectionEnd > projectionStart);
  assert.doesNotMatch(projection, /answer_key/);
  assert.doesNotMatch(projection, /explanation/);
  assert.match(projection, /q\.prompt, q\.question_type, q\.options/);

  const gradingStart = runtime.indexOf('export async function submitMyAssessmentAttempt');
  const grading = runtime.slice(gradingStart);
  assert.match(grading, /q\.answer_key/);
  assert.match(grading, /gradeQuestion/);
});

test('published assessment/question versions and attempts are immutable/pinned by database constraints', () => {
  assert.match(migration, /non-draft learning question versions are immutable/);
  assert.match(migration, /only draft learning question versions may edit content/);
  assert.match(migration, /non-draft learning assessment versions are immutable/);
  assert.match(migration, /learning assessment items may mutate only while version is DRAFT/);
  assert.match(migration, /learning assessment attempt identity is immutable/);
  assert.match(migration, /course assessment attempt must match pinned enrollment version/);
});

test('all assessment-owned tenant data uses FORCE RLS', () => {
  for (const table of [
    'learning_question_banks',
    'learning_questions',
    'learning_question_versions',
    'learning_assessments',
    'learning_assessment_versions',
    'learning_assessment_items',
    'learning_assessment_attempts',
    'learning_assessment_responses',
  ]) {
    assert.match(
      migration,
      new RegExp('ALTER TABLE platform\\.' + table + ' FORCE ROW LEVEL SECURITY'),
    );
  }
});

test('assessment execution emits governed domain events through existing outbox', () => {
  assert.match(runtime, /appendDomainEventWithOutbox/);
  assert.match(runtime, /learning\.assessment\.started/);
  assert.match(runtime, /learning\.assessment\.passed/);
  assert.match(runtime, /learning\.assessment\.failed/);
  assert.match(runtime, /LEARNING_ASSESSMENT_ATTEMPT_LIMIT_REACHED/);
  assert.match(runtime, /idempotent: true/);
});
