import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(
  new URL('../app/api/learning/me/enrollments/[enrollmentId]/lessons/[lessonId]/assets/[assetId]/read-grant/route.ts', import.meta.url),
  'utf8',
);

test('learner grant route derives authority from authenticated context', () => {
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /withTenantTransaction\(context/);
  assert.match(route, /subjectId: context\.subjectId/);
  assert.match(route, /subjectIssuer: context\.issuer/);
  assert.doesNotMatch(route, /request\.json/);
  assert.doesNotMatch(route, /hasLearningAuthoringRole/);
});

test('learner grant route validates opaque resource identifiers and fails closed', () => {
  assert.match(route, /requireLearningUuid/);
  assert.match(route, /LEARNING_ASSET_ACCESS_DENIED/);
  assert.match(route, /contentAssetJson\([\s\S]*404/);
});
