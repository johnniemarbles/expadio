import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../app/(workspace)/learning/assignments/page.tsx', import.meta.url), 'utf8');

test('assignment workspace monitors persisted automation executions for admins only', () => {
  assert.match(page, /hasLearningAdmin/);
  assert.match(page, /withBrandTransaction/);
  assert.match(page, /listLearningAssignmentRuleExecutions/);
  assert.match(page, /tenantId: context\.tenantId/);
  assert.match(page, /Rule execution monitor/);
});

test('monitor renders real outcomes and trace evidence without mocks', () => {
  assert.match(page, /execution\.outcome/);
  assert.match(page, /execution\.correlationId/);
  assert.match(page, /execution\.triggerEventId/);
  assert.match(page, /execution\.enrollmentId \?\? execution\.programEnrollmentId/);
  assert.match(page, /ASSIGNED/);
  assert.match(page, /SATISFIED/);
  assert.match(page, /NOT_MATCHED/);
  assert.doesNotMatch(page, /mock|fixture|setTimeout/i);
});
