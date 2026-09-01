import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('tenant admins use governed learner and enrollment runtime primitives', () => {
  const learner = read('../app/api/learning/learners/route.ts');
  const enrollment = read('../app/api/learning/enrollments/route.ts');
  assert.match(learner, /createLearningLearner/);
  assert.match(enrollment, /createLearningEnrollment/);
  assert.match(learner, /hasLearningAdmin/);
  assert.match(enrollment, /hasLearningAdmin/);
});

test('learner progress is identity-bound by the backend runtime', () => {
  const progress = read('../app/api/learning/progress/complete/route.ts');
  assert.match(progress, /completeMyLearningLesson/);
  assert.match(progress, /subjectId: context\.subjectId/);
  assert.match(progress, /subjectIssuer: context\.issuer/);
  assert.doesNotMatch(progress, /hasLearningAdmin/);
});

test('learner course view resolves only from my-learning enrollment set', () => {
  const page = read('../app/(workspace)/learn/[id]/page.tsx');
  assert.match(page, /listMyLearningEnrollments/);
  assert.match(page, /find\(\(entry\) => entry\.enrollmentId === id\)/);
});
