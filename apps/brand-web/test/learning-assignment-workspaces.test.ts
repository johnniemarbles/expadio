import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const player = readFileSync(new URL('../app/(workspace)/learn/[id]/page.tsx', import.meta.url), 'utf8');
const form = readFileSync(new URL('../components/LearnerAssignmentForm.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/(workspace)/learning/assignments/page.tsx', import.meta.url), 'utf8');
const queue = readFileSync(new URL('../components/AssignmentGradingQueue.tsx', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../../../packages/postgres-runtime/src/learning-assignment.ts', import.meta.url), 'utf8');

test('governed ASSIGNMENT blocks render the native submission form', () => {
  assert.match(player, /type === 'ASSIGNMENT'/);
  assert.match(player, /LearnerAssignmentForm/);
  assert.match(player, /assignmentKey={data\.definitionId}/);
  assert.match(form, /\/api\/learning\/assignments\/submit/);
  assert.match(form, /submissionKey: stableKey/);
  assert.match(form, /crypto\.randomUUID/);
  assert.doesNotMatch(form, /tenantId|learnerId|subjectId/);
});

test('grader workspace loads canonical submissions behind admin authorization', () => {
  assert.match(page, /hasLearningAdmin/);
  assert.match(page, /listLearningAssignmentSubmissions/);
  assert.match(page, /AssignmentGradingQueue/);
  assert.match(queue, /Return for revision/);
  assert.match(queue, /Save grade/);
  assert.match(queue, /max={submission\.maxPoints}/);
  assert.doesNotMatch(queue, /setTimeout|mock|fixture/i);
});

test('learner submission history is identity-bound in runtime', () => {
  assert.match(runtime, /listMyLearningAssignmentSubmissions/);
  assert.match(runtime, /learner\.subject_id = \$2/);
  assert.match(runtime, /learner\.subject_issuer IS NOT DISTINCT FROM \$3/);
});
