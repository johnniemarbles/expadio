import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WorkflowStageDecisionGateEvaluator,
  type InstantiatedWorkflowBlueprint,
  type WorkflowInstance,
  type WorkflowStageDecisionProvider,
  type WorkflowStageDefinition,
} from '../src/index.ts';

function stage(input: { decisionRequired: boolean; decisionOutcomes?: readonly string[] }): WorkflowStageDefinition {
  return {
    stageKey: 'decision',
    label: 'Decision',
    sequence: 0,
    kind: 'DECISION',
    isMandatory: true,
    canBeDeactivated: false,
    isParallel: false,
    requiredParticipantKeys: [],
    decisionRequired: input.decisionRequired,
    decisionOutcomes: input.decisionOutcomes ?? [],
    entryConditions: [],
    exitConditions: [],
    blockingRequirementKeys: [],
    autoAdvance: false,
    onReject: 'TERMINATE',
  };
}

const blueprint: InstantiatedWorkflowBlueprint = {
  blueprintKey: 'partner-onboarding',
  version: 1,
  scope: 'TENANT',
  workTypeKey: 'partner-onboarding',
  stages: [],
};

const instance: WorkflowInstance = {
  instanceId: '11111111-1111-1111-1111-111111111111',
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  workTypeKey: blueprint.workTypeKey,
  subject: { type: 'PARTNER', id: 'partner-1' },
  blueprint: { blueprintKey: blueprint.blueprintKey, version: 1, scope: 'TENANT' },
  state: 'RUNNING',
  currentStageKey: 'decision',
  revision: 0,
  createdAt: '2026-08-25T07:00:00.000Z',
  updatedAt: '2026-08-25T07:00:00.000Z',
};

function context(fromStage: WorkflowStageDefinition) {
  const next = { ...stage({ decisionRequired: false }), stageKey: 'next', kind: 'CUSTOM' as const };
  return {
    instance,
    blueprint: { ...blueprint, stages: [fromStage, next] },
    intent: {
      instanceId: instance.instanceId,
      expectedRevision: 0,
      fromStageKey: fromStage.stageKey,
      toStageKey: next.stageKey,
      requestedBySubjectId: 'subject-1',
      requestedAt: instance.updatedAt,
    },
    fromStage,
    toStage: next,
  };
}

function provider(result: Awaited<ReturnType<WorkflowStageDecisionProvider['resolve']>>): WorkflowStageDecisionProvider {
  return { async resolve() { return result; } };
}

test('does not query decision provider when stage does not require a decision', async () => {
  let reads = 0;
  const evaluator = new WorkflowStageDecisionGateEvaluator({
    async resolve() { reads += 1; return null; },
  });
  const result = await evaluator.evaluate(context(stage({ decisionRequired: false })));
  assert.equal(result.allowed, true);
  assert.equal(reads, 0);
});

test('blocks decision-required stage when no recorded outcome exists', async () => {
  const result = await new WorkflowStageDecisionGateEvaluator(provider(null))
    .evaluate(context(stage({ decisionRequired: true, decisionOutcomes: ['APPROVED', 'REJECTED'] })));

  assert.equal(result.allowed, false);
  assert.equal(result.blockers[0]?.kind, 'DECISION');
  assert.equal(result.blockers[0]?.code, 'WORKFLOW_DECISION_REQUIRED');
});

test('blocks a recorded outcome not declared by the blueprint', async () => {
  const result = await new WorkflowStageDecisionGateEvaluator(provider({
    stageKey: 'decision',
    status: 'RECORDED',
    decisionId: 'decision-1',
    outcome: 'DEFERRED',
    code: 'WORKFLOW_DECISION_RECORDED',
    evidenceRefs: [],
  })).evaluate(context(stage({ decisionRequired: true, decisionOutcomes: ['APPROVED', 'REJECTED'] })));

  assert.equal(result.allowed, false);
  assert.equal(result.blockers[0]?.code, 'WORKFLOW_DECISION_OUTCOME_INVALID');
});

test('allows a recorded outcome declared by the blueprint', async () => {
  const result = await new WorkflowStageDecisionGateEvaluator(provider({
    stageKey: 'decision',
    status: 'RECORDED',
    decisionId: 'decision-1',
    outcome: 'APPROVED',
    decidedBySubjectId: 'subject-1',
    decidedAt: '2026-08-25T08:00:00.000Z',
    code: 'WORKFLOW_DECISION_RECORDED',
    evidenceRefs: ['decision:decision-1'],
  })).evaluate(context(stage({ decisionRequired: true, decisionOutcomes: ['APPROVED', 'REJECTED'] })));

  assert.equal(result.allowed, true);
  assert.deepEqual(result.trace, ['decision:WORKFLOW_DECISION_RECORDED:APPROVED']);
});
