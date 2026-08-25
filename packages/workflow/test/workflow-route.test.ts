import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SequentialWorkflowRouteEvaluator,
  type InstantiatedWorkflowBlueprint,
  type WorkflowInstance,
  type WorkflowStageDefinition,
} from '../src/index.ts';

function stage(input: Partial<WorkflowStageDefinition> & Pick<WorkflowStageDefinition, 'stageKey' | 'sequence'>): WorkflowStageDefinition {
  return {
    stageKey: input.stageKey,
    label: input.stageKey,
    sequence: input.sequence,
    kind: input.kind ?? 'CUSTOM',
    isMandatory: input.isMandatory ?? true,
    canBeDeactivated: input.canBeDeactivated ?? false,
    isParallel: input.isParallel ?? false,
    ...(input.parallelGroupKey === undefined ? {} : { parallelGroupKey: input.parallelGroupKey }),
    requiredParticipantKeys: input.requiredParticipantKeys ?? [],
    decisionRequired: input.decisionRequired ?? false,
    decisionOutcomes: input.decisionOutcomes ?? [],
    entryConditions: input.entryConditions ?? [],
    exitConditions: input.exitConditions ?? [],
    blockingRequirementKeys: input.blockingRequirementKeys ?? [],
    ...(input.slaPolicyKey === undefined ? {} : { slaPolicyKey: input.slaPolicyKey }),
    autoAdvance: input.autoAdvance ?? false,
    onReject: input.onReject ?? 'TERMINATE',
    ...(input.returnToStageKey === undefined ? {} : { returnToStageKey: input.returnToStageKey }),
  };
}

const qualification = stage({ stageKey: 'qualification', sequence: 0 });
const review = stage({ stageKey: 'review', sequence: 1, returnToStageKey: 'qualification' });
const decision = stage({ stageKey: 'decision', sequence: 2 });
const parallel = stage({ stageKey: 'parallel-check', sequence: 3, isParallel: true, parallelGroupKey: 'checks' });

const blueprint: InstantiatedWorkflowBlueprint = {
  blueprintKey: 'partner-onboarding',
  version: 2,
  scope: 'TENANT',
  workTypeKey: 'partner-onboarding',
  stages: [qualification, review, decision, parallel],
};

const instance: WorkflowInstance = {
  instanceId: '11111111-1111-1111-1111-111111111111',
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  workTypeKey: blueprint.workTypeKey,
  subject: { type: 'PARTNER', id: 'partner-1' },
  blueprint: { blueprintKey: blueprint.blueprintKey, version: blueprint.version, scope: blueprint.scope },
  state: 'RUNNING',
  currentStageKey: 'qualification',
  revision: 0,
  createdAt: '2026-08-25T07:00:00.000Z',
  startedAt: '2026-08-25T07:00:01.000Z',
  updatedAt: '2026-08-25T07:00:01.000Z',
};

const evaluator = new SequentialWorkflowRouteEvaluator();

test('allows bootstrap only into the first sequential stage', async () => {
  const allowed = await evaluator.evaluate({
    instance: { ...instance, currentStageKey: undefined },
    blueprint,
    intent: {
      instanceId: instance.instanceId,
      expectedRevision: 0,
      toStageKey: 'qualification',
      requestedBySubjectId: 'subject-1',
      requestedAt: instance.updatedAt,
    },
    toStage: qualification,
  });
  assert.equal(allowed.allowed, true);

  const blocked = await evaluator.evaluate({
    instance: { ...instance, currentStageKey: undefined },
    blueprint,
    intent: {
      instanceId: instance.instanceId,
      expectedRevision: 0,
      toStageKey: 'review',
      requestedBySubjectId: 'subject-1',
      requestedAt: instance.updatedAt,
    },
    toStage: review,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.blockers[0]?.code, 'WORKFLOW_ROUTE_NOT_ALLOWED');
});

test('allows only the next sequential stage for forward movement', async () => {
  const allowed = await evaluator.evaluate({
    instance,
    blueprint,
    intent: {
      instanceId: instance.instanceId,
      expectedRevision: 0,
      fromStageKey: 'qualification',
      toStageKey: 'review',
      requestedBySubjectId: 'subject-1',
      requestedAt: instance.updatedAt,
    },
    fromStage: qualification,
    toStage: review,
  });
  assert.equal(allowed.allowed, true);

  const skipped = await evaluator.evaluate({
    instance,
    blueprint,
    intent: {
      instanceId: instance.instanceId,
      expectedRevision: 0,
      fromStageKey: 'qualification',
      toStageKey: 'decision',
      requestedBySubjectId: 'subject-1',
      requestedAt: instance.updatedAt,
    },
    fromStage: qualification,
    toStage: decision,
  });
  assert.equal(skipped.allowed, false);
});

test('allows an explicit configured return route', async () => {
  const result = await evaluator.evaluate({
    instance: { ...instance, currentStageKey: 'review' },
    blueprint,
    intent: {
      instanceId: instance.instanceId,
      expectedRevision: 0,
      fromStageKey: 'review',
      toStageKey: 'qualification',
      requestedBySubjectId: 'subject-1',
      requestedAt: instance.updatedAt,
    },
    fromStage: review,
    toStage: qualification,
  });

  assert.equal(result.allowed, true);
  assert.deepEqual(result.trace, ['route:configured-return']);
});

test('fails closed for parallel-stage execution', async () => {
  const result = await evaluator.evaluate({
    instance: { ...instance, currentStageKey: 'decision' },
    blueprint,
    intent: {
      instanceId: instance.instanceId,
      expectedRevision: 0,
      fromStageKey: 'decision',
      toStageKey: 'parallel-check',
      requestedBySubjectId: 'subject-1',
      requestedAt: instance.updatedAt,
    },
    fromStage: decision,
    toStage: parallel,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.blockers[0]?.code, 'WORKFLOW_PARALLEL_RUNTIME_UNSUPPORTED');
});
