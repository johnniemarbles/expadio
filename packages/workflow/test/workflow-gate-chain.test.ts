import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OrderedWorkflowTransitionGateEvaluator,
  allowedWorkflowGateDecision,
  blockedWorkflowGateDecision,
  type InstantiatedWorkflowBlueprint,
  type WorkflowInstance,
  type WorkflowStageDefinition,
  type WorkflowTransitionGateContext,
  type WorkflowTransitionGateEvaluator,
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

const context: WorkflowTransitionGateContext = {
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

function evaluator(fn: WorkflowTransitionGateEvaluator['evaluate']): WorkflowTransitionGateEvaluator {
  return { evaluate: fn };
}

test('runs all allowed gates in order and concatenates trace', async () => {
  const calls: string[] = [];
  const chain = new OrderedWorkflowTransitionGateEvaluator([
    evaluator(async () => {
      calls.push('base');
      return allowedWorkflowGateDecision(['base:allowed']);
    }),
    evaluator(async () => {
      calls.push('participant');
      return allowedWorkflowGateDecision(['participant:allowed']);
    }),
  ]);

  const result = await chain.evaluate(context);
  assert.equal(result.allowed, true);
  assert.deepEqual(calls, ['base', 'participant']);
  assert.deepEqual(result.trace, ['base:allowed', 'participant:allowed']);
});

test('short-circuits at the first blocking gate and preserves prior trace', async () => {
  let thirdCalled = false;
  const chain = new OrderedWorkflowTransitionGateEvaluator([
    evaluator(async () => allowedWorkflowGateDecision(['base:allowed'])),
    evaluator(async () => blockedWorkflowGateDecision({
      blockers: [{ kind: 'ASSIGNMENT', code: 'WORKFLOW_PARTICIPANT_UNAVAILABLE', key: 'reviewer' }],
      trace: ['participant:blocked'],
    })),
    evaluator(async () => {
      thirdCalled = true;
      return allowedWorkflowGateDecision(['authorization:allowed']);
    }),
  ]);

  const result = await chain.evaluate(context);
  assert.equal(result.allowed, false);
  assert.equal(thirdCalled, false);
  assert.equal(result.blockers[0]?.code, 'WORKFLOW_PARTICIPANT_UNAVAILABLE');
  assert.deepEqual(result.trace, ['base:allowed', 'participant:blocked']);
});
