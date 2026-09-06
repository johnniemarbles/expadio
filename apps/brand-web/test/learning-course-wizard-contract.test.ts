import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const drawer = readFileSync(
  new URL('../app/(workspace)/learning/CourseCreateDrawer.tsx', import.meta.url),
  'utf8',
);
const route = readFileSync(
  new URL('../app/api/learning/courses/route.ts', import.meta.url),
  'utf8',
);

test('course wizard sends the complete authoring intent without placeholder media', () => {
  assert.match(drawer, /estimatedDuration: draft\.estimatedDuration/);
  assert.match(drawer, /visibility: draft\.visibility/);
  assert.match(drawer, /modules: draft\.modules/);
  assert.match(drawer, /publish: isPublish/);
  assert.doesNotMatch(drawer, /example\.com\/video1\.mp4/);
});

test('course API maps wizard modules and lessons to the native Learning contract', () => {
  assert.match(route, /moduleKey: stableKey/);
  assert.match(route, /lessonKey: stableKey/);
  assert.match(route, /activityType: ACTIVITY_TYPES/);
  assert.match(route, /estimatedMinutes:/);
  assert.match(route, /content: contentFor\(lesson\)/);
  assert.match(route, /modules: nativeModules\(body\.modules\)/);
});

test('publication is explicit and uses the canonical immutable publish operation', () => {
  assert.match(route, /if \(body\.publish !== true\)/);
  assert.match(route, /publishLearningCourseVersion/);
  assert.match(route, /version: created\.version\.version/);
  assert.match(route, /published: true/);
});

test('course creation remains tenant resolved and Learning-admin protected', () => {
  assert.match(route, /resolveBrandContext\(\)/);
  assert.match(route, /withBrandTransaction/);
  assert.match(route, /hasLearningAdmin/);
});
