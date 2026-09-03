import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const submit = readFileSync(new URL('../app/api/learning/assignments/submit/route.ts', import.meta.url), 'utf8');
const list = readFileSync(new URL('../app/api/learning/assignments/submissions/route.ts', import.meta.url), 'utf8');
const grade = readFileSync(new URL('../app/api/learning/assignments/submissions/[submissionId]/grade/route.ts', import.meta.url), 'utf8');

test('learner identity and tenant are derived from Brand context', () => {
  assert.match(submit, /resolveBrandContext\(\)/);
  assert.match(submit, /tenantId: context\.tenantId/);
  assert.match(submit, /subjectId: context\.subjectId/);
  assert.match(submit, /subjectIssuer: context\.issuer/);
  assert.doesNotMatch(submit, /body\.tenantId|body\.learnerId|body\.subjectId/);
});

test('grading queue and mutation require Learning administration', () => {
  assert.match(list, /hasLearningAdmin/);
  assert.match(grade, /hasLearningAdmin/);
  assert.match(list, /withBrandTransaction/);
  assert.match(grade, /withBrandTransaction/);
  assert.match(grade, /actorSubjectId: context\.subjectId/);
});
