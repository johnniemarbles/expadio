import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CompositeWorkflowTransitionGateEvaluator,
  allowedWorkflowGateDecision,
  blockedWorkflowGateDecision,
  type InstantiatedWorkflowBlueprint,
  type WorkflowConditionEvaluator,
  type WorkflowInstance,
  type WorkflowRequirementStatusProvider,
  type WorkflowStageDefinition,
  type WorkflowTransitionGateContext,
  type WorkflowTransitionGateEvaluator,
} from '../src/index.ts';

function stage(input: Partial<WorkflowStageDefinition> & Pick<WorkflowStageDefinition, 'stageKey' | 'sequence'>): WorkflowStageDefinition {
  return {
    stageKey: input.stageKey,
    label: input.stageKey,
    sequence: input.sequence,
    kind: 'CUSTOM',
    isMandatory: true,
    canBeDeactivated: false,
    isParallel: false,
    requiredParticipantKeys: [],
    decisionRequired: false,
    decisionOutcomes: [],
    entryConditions: input.entryConditions ?? [],
    exitConditions: input.exitConditions ?? [],
    blockingRequirementKeys: input.blockingRequirementKeys ?? [],
    autoAdvance: false,
    onReject: 'TERMINATE',
  };
}

const fromStage = stage({
  stageKey: 'qualification',
  sequence: 0,
  exitConditions: [{ type: 'minimum-score' }],
  blockingRequirementKeys: ['identity-check', 'reference-check'],
});
const toStage = stage({
  stageKey: 'review',
  sequence: 1,
  entryConditions: [{ type: 'review-window-open' }],
});
const blueprint: InstantiatedWorkflowBlueprint = {
  blueprintKey: 'partner-onboarding',
  version: 2,
  scope: 'TENANT',
  workTypeKey: 'partner-onboarding',
  stages: [fromStage, toStage],
};
const instance: WorkflowInstance = {
  instanceId: '11111111-1111-1111-1111-111111111111',
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  workTypeKey: blueprint.workTypeKey,
  subject: { type: 'PARTNER', id: 'partner-1' },
  blueprint: { blueprintKey: blueprint.blueprintKey, version: blueprint.version, scope: blueprint.scope },
  state: 'RUNNING',
  currentStageKey: 'qualification',
  revision: 3,
  createdAt: '2026-08-25T07:00:00.000Z',
  startedAt: '2026-08-25T07:00:01.000Z',
  updatedAt: '2026-08-25T07:10:00.000Z',
};
const context: WorkflowTransitionGateContext = {
  instance,
  blueprint,
  intent: {
    instanceId: instance.instanceId,
    expectedRevision: 3,
    fromStageKey: 'qualification',
    toStageKey: 'review',
    requestedBySubjectId: 'subject-1',
    requestedAt: '2026-08-25T07:11:00.000Z',
  },
  fromStage,
  toStage,
};

test('route blocker short-circuits deeper condition and requirement checks', async () => {
  let conditionCalls = 0;
  let requirementCalls = 0;
  const route: WorkflowTransitionGateEvaluator = {
    async evaluate() {
      return blockedWorkflowGateDecision({
        blockers: [{ kind: 'ROUTE', code: 'WORKFLOW_ROUTE_NOT_ALLOWED' }],
        trace: ['route:blocked'],
      });
    },
  };
  const conditions: WorkflowConditionEvaluator = {
    async evaluate() {
      conditionCalls += 1;
      return { satisfied: true, code: 'OK', evidenceRefs: [] };
    },
  };
  const requirements: WorkflowRequirementStatusProvider = {
    async resolve() {
      requirementCalls += 1;
      return [];
    },
  };

  const result = await new CompositeWorkflowTransitionGateEvaluator({ route, conditions, requirements }).evaluate(context);

  assert.equal(result.allowed, false);
  assert.equal(conditionCalls, 0);
  assert.equal(requirementCalls, 0);
});

test('aggregates exit, requirement and entry blockers with deterministic trace', async () => {
  const route: WorkflowTransitionGateEvaluator = {
    async evaluate() {
      return allowedWorkflowGateDecision(['route:next-stage']);
    },
  };
  const conditions: WorkflowConditionEvaluator = {
    async evaluate(input) {
      if (input.context.phase === 'EXIT') {
        return { satisfied: false, code: 'MINIMUM_SCORE_NOT_MET', evidenceRefs: ['score:1'] };
      }
      return { satisfied: false, code: 'REVIEW_WINDOW_CLOSED', evidenceRefs: ['calendar:1'] };
    },
  };
  const requirements: WorkflowRequirementStatusProvider = {
    async resolve() {
      return [{
        requirementKey: 'identity-check',
        state: 'PENDING',
        waiver: { allowed: false, applied: false },
        code: 'IDENTITY_CHECK_PENDING',
        evidenceRefs: [],
      }];
    },
  };

  const result = await new CompositeWorkflowTransitionGateEvaluator({ route, conditions, requirements }).evaluate(context);

  assert.equal(result.allowed, false);
  assert.deepEqual(result.blockers.map((item) => [item.kind, item.code, item.key]), [
    ['EXIT_CONDITION', 'MINIMUM_SCORE_NOT_MET', 'minimum-score'],
    ['REQUIREMENT', 'IDENTITY_CHECK_PENDING', 'identity-check'],
    ['REQUIREMENT', 'WORKFLOW_REQUIREMENT_STATUS_MISSING', 'reference-check'],
    ['ENTRY_CONDITION', 'REVIEW_WINDOW_CLOSED', 'review-window-open'],
  ]);
  assert.deepEqual(result.trace, [
    'route:next-stage',
    'exit-condition:minimum-score:MINIMUM_SCORE_NOT_MET',
    'requirement:identity-check:IDENTITY_CHECK_PENDING',
    'requirement:reference-check:missing',
    'entry-condition:review-window-open:REVIEW_WINDOW_CLOSED',
  ]);
});

test('allows transition when conditions pass and requirements are satisfied or validly waived', async () => {
  const route: WorkflowTransitionGateEvaluator = {
    async evaluate() {
      return allowedWorkflowGateDecision(['route:next-stage']);
    },
  };
  const conditions: WorkflowConditionEvaluator = {
    async evaluate() {
      return { satisfied: true, code: 'CONDITION_SATISFIED', evidenceRefs: [] };
    },
  };
  const requirements: WorkflowRequirementStatusProvider = {
    async resolve() {
      return [
        {
          requirementKey: 'identity-check',
          state: 'SATISFIED',
          waiver: { allowed: false, applied: false },
          code: 'IDENTITY_CHECK_SATISFIED',
          evidenceRefs: ['document:1'],
        },
        {
          requirementKey: 'reference-check',
          state: 'WAIVED',
          waiver: { allowed: true, applied: true, waiverId: 'waiver-1' },
          code: 'REFERENCE_CHECK_WAIVED',
          evidenceRefs: ['waiver:1'],
        },
      ];
    },
  };

  const result = await new CompositeWorkflowTransitionGateEvaluator({ route, conditions, requirements }).evaluate(context);

  assert.equal(result.allowed, true);
  assert.deepEqual(result.blockers, []);
});
