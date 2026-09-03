import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync(new URL('../../../packages/postgres-runtime/src/learning-assignment.ts', import.meta.url), 'utf8');
const create = readFileSync(new URL('../app/api/learning/assignments/route.ts', import.meta.url), 'utf8');
const publish = readFileSync(new URL('../app/api/learning/assignments/[assignmentId]/versions/[version]/publish/route.ts', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../components/AssignmentAuthoring.tsx', import.meta.url), 'utf8');
const course = readFileSync(new URL('../app/(workspace)/learning/courses/[id]/page.tsx', import.meta.url), 'utf8');

test('assignment authoring is pinned to an active draft course version', () => {
  assert.match(runtime, /version\.state = 'DRAFT'/);
  assert.match(runtime, /course\.status = 'ACTIVE'/);
  assert.match(runtime, /LEARNING_ASSIGNMENT_DRAFT_COURSE_REQUIRED/);
  assert.match(runtime, /learning_assignment_versions/);
});

test('publication requires the governed block reference and records provenance', () => {
  assert.match(runtime, /block->>'type' = 'ASSIGNMENT'/);
  assert.match(runtime, /block->'data'->>'definitionId' = \$3/);
  assert.match(runtime, /LEARNING_ASSIGNMENT_BLOCK_REFERENCE_REQUIRED/);
  assert.match(runtime, /learning\.assignment\.version\.published/);
  assert.match(runtime, /appendDomainEventWithOutbox/);
});

test('Brand routes derive administration and actor authority from context', () => {
  for (const route of [create, publish]) {
    assert.match(route, /resolveBrandContext\(\)/);
    assert.match(route, /hasLearningAdmin/);
    assert.match(route, /withBrandTransaction/);
    assert.doesNotMatch(route, /body\.tenantId|body\.actorSubjectId/);
  }
});

test('course workflow creates, attaches and publishes without mock state', () => {
  assert.match(course, /AssignmentAuthoring/);
  assert.match(editor, /\/api\/learning\/assignments'/);
  assert.match(editor, /type: 'ASSIGNMENT'/);
  assert.match(editor, /definitionId: created\.assignmentKey/);
  assert.match(editor, /SAVING_BLOCK/);
  assert.match(editor, /PUBLISHING/);
  assert.doesNotMatch(editor, /setTimeout|mock|fixture/i);
});
