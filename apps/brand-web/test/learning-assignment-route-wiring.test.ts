import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(
  new URL('../app/(workspace)/learning/assignments/page.tsx', import.meta.url),
  'utf8',
);

test('assignment workspace exposes rule authoring on the concrete assignments route', () => {
  assert.match(page, /LearningSectionAdminPanel/);
  assert.match(page, /section="assignments"/);
  assert.match(page, /courseTargets=\{courseTargets\}/);
  assert.match(page, /programTargets=\{programTargets\}/);
  assert.match(page, /listLearningCourses/);
  assert.match(page, /listLearningPrograms/);
});

test('assignment workspace keeps grading and execution monitoring together', () => {
  assert.match(page, /AssignmentGradingQueue/);
  assert.match(page, /listLearningAssignmentRuleExecutions/);
  assert.match(page, /Rule execution monitor/);
});

test('assignment rule targets are restricted to active published content', () => {
  assert.match(page, /course\.status === 'ACTIVE'/);
  assert.match(page, /course\.currentPublishedVersion !== null/);
  assert.match(page, /program\.status === 'ACTIVE'/);
  assert.match(page, /program\.currentPublishedVersion !== null/);
});
