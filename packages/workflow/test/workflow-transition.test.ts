import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitWorkflowStageTransition,
  WorkflowTransitionError,
  type InstantiatedWorkflowBlueprint,
  type WorkflowInstance,
  type WorkflowTransitionIntent,
} from '../src/index.ts';

const blueprint: InstantiatedWorkflowBlueprint = {
  blueprintKey: 'partner-onboarding',
  version: 7,
  scope: 'TENANT',
  workTypeKey: 'partner-onboarding',
  stages: [
    {
      stageKey: 'qualification',
      label: 'Qualification',
      sequence: 0,
      kind: 'QUALIFICATION',
      isMandatory: true,
      canBeDeactivated: false,
      isParallel: false,
      requiredParticipantKeys: ['reviewer'],
      decisionRequired: false,
      decisionOutcomes: [],
      entryConditions: [],
      exitConditions: [],
      blockingRequirementKeys: [],
      autoAdvance: false,
      onReject: 'TERMINATE',
    },
    {
      stageKey: 'review',
      label: 'Review',
      sequence: 1,
      kind: 'REVIEW',
      isMandatory: true,
      canBeDeactivated: false,
      isParallel: false,
      requiredParticipantKeys: ['reviewer'],
      decisionRequired: false,
      decisionOutcomes: [],
      entryConditions: [],
      exitConditions: [],
      blockingRequirementKeys: [],
      autoAdvance: false,
      onReject: 'RETURN',
      returnToStageKey: 'qualification',
    },
  ],
};

const instance: WorkflowInstance = {
  instanceId: 'instance-1',
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  workTypeKey: blueprint.workTypeKey,
  subject: { type: 'lead-case', id: 'case-1' },
  blueprint: {
    blueprintKey: blueprint.blueprintKey,
    version: blueprint.version,
    scope: blueprint.scope,
  },
  state: 'RUNNING',
  currentStageKey: 'qualification',
  revision: 3,
  createdAt: '2026-08-25T06:00:00.000Z',
  startedAt: '2026-08-25T06:01:00.000Z',
  updatedAt: '2026-08-25T06:05:00.000Z',
};

const intent: WorkflowTransitionIntent = {
  instanceId: instance.instanceId,
  expectedRevision: 3,
  fromStageKey: 'qualification',
  toStageKey: 'review',
  requestedBySubjectId: 'user-1',
  requestedAt: '2026-08-25T06:06:00.000Z',
  reason: 'qualification completed',
};

test('commits an already-authorized stage transition deterministically', () => {
  const result = commitWorkflowStageTransition({ instance, blueprint, intent });

  assert.equal(result.instance.currentStageKey, 'review');
  assert.equal(result.instance.revision, 4);
  assert.equal(result.instance.updatedAt, intent.requestedAt);
  assert.deepEqual(result.record, {
    instanceId: 'instance-1',
    fromStageKey: 'qualification',
    toStageKey: 'review',
    fromState: 'RUNNING',
    toState: 'RUNNING',
    revision: 4,
    transitionedBySubjectId: 'user-1',
    transitionedAt: '2026-08-25T06:06:00.000Z',
    reason: 'qualification completed',
  });
});

test('rejects stale revision before applying transition', () => {
  assert.throws(
    () => commitWorkflowStageTransition({
      instance,
      blueprint,
      intent: { ...intent, expectedRevision: 2 },
    }),
    (error: unknown) => error instanceof WorkflowTransitionError
      && error.code === 'WORKFLOW_INSTANCE_REVISION_MISMATCH',
  );
});

test('rejects blueprint, current-stage, and target-stage mismatches', () => {
  assert.throws(
    () => commitWorkflowStageTransition({
      instance,
      blueprint: { ...blueprint, version: 8 },
      intent,
    }),
    (error: unknown) => error instanceof WorkflowTransitionError
      && error.code === 'WORKFLOW_INSTANCE_BLUEPRINT_MISMATCH',
  );

  assert.throws(
    () => commitWorkflowStageTransition({
      instance,
      blueprint,
      intent: { ...intent, fromStageKey: 'review' },
    }),
    (error: unknown) => error instanceof WorkflowTransitionError
      && error.code === 'WORKFLOW_INSTANCE_STAGE_MISMATCH',
  );

  assert.throws(
    () => commitWorkflowStageTransition({
      instance,
      blueprint,
      intent: { ...intent, toStageKey: 'missing' },
    }),
    (error: unknown) => error instanceof WorkflowTransitionError
      && error.code === 'WORKFLOW_TARGET_STAGE_NOT_FOUND',
  );
});

test('rejects stage movement while workflow is not RUNNING', () => {
  assert.throws(
    () => commitWorkflowStageTransition({
      instance: { ...instance, state: 'PAUSED' },
      blueprint,
      intent,
    }),
    (error: unknown) => error instanceof WorkflowTransitionError
      && error.code === 'WORKFLOW_INSTANCE_NOT_RUNNING',
  );
});
