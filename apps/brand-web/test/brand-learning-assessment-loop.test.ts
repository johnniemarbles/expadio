import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Brand learner assessment APIs remain identity-bound and tenant-scoped', () => {
  for (const route of [
    '../app/api/learning/me/assessments/route.ts',
    '../app/api/learning/me/assessments/[id]/attempts/route.ts',
    '../app/api/learning/me/assessment-attempts/[attemptId]/submit/route.ts',
  ]) {
    const source = read(route);
    assert.match(source, /resolveBrandContext/);
    assert.match(source, /withBrandTransaction/);
    assert.match(source, /subjectId: context\.subjectId/);
    assert.match(source, /subjectIssuer: context\.issuer/);
    assert.doesNotMatch(source, /hasLearningAdmin/);
    assert.doesNotMatch(source, /platform-web/);
  }
});

test('Learner course player exposes assigned assessment execution', () => {
  const page = read('../app/(workspace)/learn/[id]/page.tsx');
  const runner = read('../components/LearnerAssessmentRunner.tsx');

  assert.match(page, /listMyAvailableAssessments/);
  assert.match(page, /assessment\.enrollmentId === enrollment\.enrollmentId/);
  assert.match(page, /LearnerAssessmentRunner/);
  assert.match(runner, /Start assessment/);
  assert.match(runner, /Submit assessment/);
  assert.match(runner, /MULTIPLE_CHOICE/);
  assert.match(runner, /Assessment passed/);
});

test('Assessment start and submit use the governed runtime primitives', () => {
  const start = read('../app/api/learning/me/assessments/[id]/attempts/route.ts');
  const submit = read('../app/api/learning/me/assessment-attempts/[attemptId]/submit/route.ts');

  assert.match(start, /startMyAssessmentAttempt/);
  assert.match(submit, /submitMyAssessmentAttempt/);
  assert.match(start, /attemptKey/);
  assert.match(submit, /responses/);
});
