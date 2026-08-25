import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WorkflowAuthorizationGateEvaluator,
  type InstantiatedWorkflowBlueprint,
  type WorkflowInstance,
  type WorkflowStageDefinition,
  type WorkflowTransitionAuthorizationProvider,
} from '../src/index.ts';

const stage: WorkflowStageDefinition = {
  stageKey: 'review',
  label: 'Review',
  sequence: 0,
  kind: 'REVIEW',
  isMandatory: true,
  canBeDeactivated: false,
  isParallel: false,
  requiredParticipantKeys: [],
  decisionRequired: false,
  decisionOutcomes: [],
  entryConditions: [],
  exitConditions: [],
  blockingRequirementKeys: [],
  autoAdvance: false,
  onReject: 'TERMINATE',
};

const blueprint: InstantiatedWorkflowBlueprint = {
  blueprintKey: 'partner-onboarding',
  version: 1,
  scope: 'TENANT',
  workTypeKey: 'partner-onboarding',
  stages: [stage],
};

const instance: WorkflowInstance = {
  instanceId: '11111111-1111-1111-1111-111111111111',
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  workTypeKey: blueprint.workTypeKey,
  subject: { type: 'PARTNER', id: 'partner-1' },
  blueprint: { blueprintKey: blueprint.blueprintKey, version: 1, scope: 'TENANT' },
  state: 'RUNNING',
  revision: 0,
  createdAt: '2026-08-25T07:00:00.000Z',
  updatedAt: '2026-08-25T07:00:00.000Z',
};

function context() {
  return {
    instance,
    blueprint,
    intent: {
      instanceId: instance.instanceId,
      expectedRevision: 0,
      toStageKey: stage.stageKey,
      requestedBySubjectId: 'subject-1',
      requestedAt: instance.updatedAt,
    },
    toStage: stage,
  };
}

test('allows transition when authorization provider grants the action', async () => {
  let action = '';
  const provider: WorkflowTransitionAuthorizationProvider = {
    async authorize(input) {
      action = input.action;
      return {
        allowed: true,
        code: 'GRANTED',
        evidenceRefs: ['authorization:1'],
      };
    },
  };
  const result = await new WorkflowAuthorizationGateEvaluator({ authorization: provider })
    .evaluate(context());

  assert.equal(action, 'workflow.transition');
  assert.equal(result.allowed, true);
  assert.deepEqual(result.trace, ['authorization:GRANTED']);
});

test('maps authorization denial to AUTHORIZATION blocker', async () => {
  const provider: WorkflowTransitionAuthorizationProvider = {
    async authorize() {
      return {
        allowed: false,
        code: 'SCOPE_MISMATCH',
        evidenceRefs: [],
      };
    },
  };
  const result = await new WorkflowAuthorizationGateEvaluator({
    authorization: provider,
    action: 'workflow.review.enter',
  }).evaluate(context());

  assert.equal(result.allowed, false);
  assert.equal(result.blockers[0]?.kind, 'AUTHORIZATION');
  assert.equal(result.blockers[0]?.code, 'SCOPE_MISMATCH');
  assert.equal(result.blockers[0]?.key, 'workflow.review.enter');
});
