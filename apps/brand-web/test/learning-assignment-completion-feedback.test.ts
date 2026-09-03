import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../../../infra/db/migrations/0141_learning_assignment_completion.sql', import.meta.url), 'utf8');
const enrollment = readFileSync(new URL('../../../packages/postgres-runtime/src/learning-enrollment.ts', import.meta.url), 'utf8');
const assignment = readFileSync(new URL('../../../packages/postgres-runtime/src/learning-assignment.ts', import.meta.url), 'utf8');
const player = readFileSync(new URL('../app/(workspace)/learn/[id]/page.tsx', import.meta.url), 'utf8');
const form = readFileSync(new URL('../components/LearnerAssignmentForm.tsx', import.meta.url), 'utf8');

test('published assignments declare authoritative completion policy', () => {
  assert.match(migration, /completion_requirement/);
  assert.match(migration, /OPTIONAL','REQUIRED/);
  assert.match(migration, /DEFAULT 'REQUIRED'/);
});

test('completion policy counts final assignment evidence from the pinned enrollment', () => {
  assert.match(enrollment, /platform\.learning_assignment_submissions/);
  assert.match(enrollment, /submission\.enrollment_id = \$2::uuid/);
  assert.match(enrollment, /submission\.status = 'GRADED'/);
  assert.match(enrollment, /requiredAssignments/);
  assert.match(enrollment, /gradedRequiredAssignments/);
  assert.match(enrollment, /requirementCount = requiredLessons \+ requiredAssessments \+ requiredAssignments/);
});

test('final grading reuses the canonical completion and credential chain', () => {
  assert.match(assignment, /input\.outcome === 'GRADED'/);
  assert.match(assignment, /reconcileLearningEnrollmentCompletion/);
  assert.match(enrollment, /reconcileLearningProgramsForEvidence/);
});

test('learner player hydrates identity-bound feedback and final score', () => {
  assert.match(player, /listMyLearningAssignmentSubmissions/);
  assert.match(player, /submission={submissions\.find/);
  assert.match(form, /Latest submission status/);
  assert.match(form, /submission\.feedback/);
  assert.match(form, /submission\.scorePoints/);
  assert.match(form, /awaitingReview \|\| graded/);
});
