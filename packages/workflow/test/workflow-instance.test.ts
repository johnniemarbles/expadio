import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowInstance,
  WorkflowTransitionIntent,
} from '../src/index.ts';

const instance: WorkflowInstance = {
  instanceId: 'instance-1',
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  workTypeKey: 'partner-onboarding',
  subject: { type: 'lead-case', id: 'case-1' },
  blueprint: {
    blueprintKey: 'partner-onboarding',
    version: 7,
    scope: 'TENANT',
  },
  industryPackProvenance: { runtimeSource: 'TENANT_PUBLISHED', verticalKey: 'dentex', version: 7 },
  state: 'RUNNING',
  currentStageKey: 'qualification',
  revision: 3,
  createdAt: '2026-08-25T06:00:00.000Z',
  startedAt: '2026-08-25T06:01:00.000Z',
  updatedAt: '2026-08-25T06:05:00.000Z',
};

const transition: WorkflowTransitionIntent = {
  instanceId: instance.instanceId,
  expectedRevision: instance.revision,
  fromStageKey: instance.currentStageKey,
  toStageKey: 'review',
  requestedBySubjectId: 'user-1',
  requestedAt: '2026-08-25T06:06:00.000Z',
  reason: 'qualification completed',
};

test('workflow instance pins exact blueprint scope and revision', () => {
  assert.deepEqual(instance.blueprint, {
    blueprintKey: 'partner-onboarding',
    version: 7,
    scope: 'TENANT',
  });
  assert.equal(instance.revision, 3);
  assert.equal(instance.subject.type, 'lead-case');
  assert.deepEqual(instance.industryPackProvenance, {
    runtimeSource: 'TENANT_PUBLISHED',
    verticalKey: 'dentex',
    version: 7,
  });
});

test('transition intent carries optimistic revision and explicit stage movement', () => {
  assert.equal(transition.expectedRevision, 3);
  assert.equal(transition.fromStageKey, 'qualification');
  assert.equal(transition.toStageKey, 'review');
  assert.equal(transition.requestedBySubjectId, 'user-1');
});
