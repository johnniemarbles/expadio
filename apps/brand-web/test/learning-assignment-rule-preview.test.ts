import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../app/api/learning/assignment-rules/preview/route.ts', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../components/LearningSectionAdminPanel.tsx', import.meta.url), 'utf8');

test('assignment rule preview is admin-only and resolves tenant authority server-side', () => {
  assert.match(route, /resolveBrandContext\(\)/);
  assert.match(route, /hasLearningAdmin/);
  assert.match(route, /withBrandTransaction/);
  assert.match(route, /tenantId: context\.tenantId/);
  assert.match(route, /Cache-Control.*private, no-store/s);
  assert.doesNotMatch(route, /body\.tenantId|body\.organizationId|body\.subjectId/);
});

test('assignment authoring shows real preview counts and matched learner evidence', () => {
  assert.match(panel, /\/api\/learning\/assignment-rules\/preview/);
  assert.match(panel, /Preview audience/);
  assert.match(panel, /matchedLearners/);
  assert.match(panel, /totalLearners/);
  assert.match(panel, /Preview is read-only and creates no assignments/);
  assert.match(panel, /learner\.fullName/);
  assert.doesNotMatch(panel, /mock|fixture|setTimeout/i);
});
