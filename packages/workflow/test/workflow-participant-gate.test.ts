import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WorkflowParticipantAssignmentGateEvaluator,
  type InstantiatedWorkflowBlueprint,
  type WorkflowInstance,
  type WorkflowParticipantAssignmentProvider,
  type WorkflowStageDefinition,
} from '../src/index.ts';

function stage(requiredParticipantKeys: readonly string[]): WorkflowStageDefinition {
  return {
    stageKey: 'review',
    label: 'Review',
    sequence: 1,
    kind: 'REVIEW',
    isMandatory: true,
    canBeDeactivated: false,
    isParallel: false,
    requiredParticipantKeys,
    decisionRequired: false,
    decisionOutcomes: [],
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
  stages: [stage(['reviewer'])],
};

const instance: WorkflowInstance = {
  instanceId: '11111111-1111-1111-1111-111111111111',
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  workTypeKey: blueprint.workTypeKey,
  subject: { type: 'PARTNER', id: 'partner-1' },
  blueprint: { blueprintKey: blueprint.blueprintKey, version: blueprint.version, scope: blueprint.scope },
  state: 'RUNNING',
  revision: 0,
  createdAt: '2026-08-25T07:00:00.000Z',
  updatedAt: '2026-08-25T07:00:00.000Z',
};

function provider(result: Awaited<ReturnType<WorkflowParticipantAssignmentProvider['resolve']>>): WorkflowParticipantAssignmentProvider {
  return { async resolve() { return result; } };
}

function context(toStage: WorkflowStageDefinition) {
  return {
    instance,
    blueprint: { ...blueprint, stages: [toStage] },
    intent: {
      instanceId: instance.instanceId,
      expectedRevision: 0,
      toStageKey: toStage.stageKey,
      requestedBySubjectId: 'subject-1',
      requestedAt: instance.updatedAt,
    },
    toStage,
  };
}

test('allows a stage when every required participant slot is assigned', async () => {
  const evaluator = new WorkflowParticipantAssignmentGateEvaluator(provider([{
    participantKey: 'reviewer',
    status: 'ASSIGNED',
    target: { kind: 'TEAM', key: 'review-team' },
    code: 'WORKFLOW_PARTICIPANT_ASSIGNED',
    evidenceRefs: [],
  }]));

  const result = await evaluator.evaluate(context(stage(['reviewer'])));
  assert.equal(result.allowed, true);
  assert.deepEqual(result.trace, ['participant:reviewer:WORKFLOW_PARTICIPANT_ASSIGNED']);
});

test('fails closed when a required participant result is missing', async () => {
  const result = await new WorkflowParticipantAssignmentGateEvaluator(provider([]))
    .evaluate(context(stage(['reviewer'])));

  assert.equal(result.allowed, false);
  assert.equal(result.blockers[0]?.kind, 'PARTICIPANT');
  assert.equal(result.blockers[0]?.code, 'WORKFLOW_PARTICIPANT_ASSIGNMENT_MISSING');
});

test('blocks an unavailable assignment and de-duplicates participant keys', async () => {
  let requested: readonly string[] = [];
  const assignments: WorkflowParticipantAssignmentProvider = {
    async resolve(input) {
      requested = input.participantKeys;
      return [{
        participantKey: 'approver',
        status: 'UNAVAILABLE',
        code: 'WORKFLOW_PARTICIPANT_UNAVAILABLE',
        evidenceRefs: [],
      }];
    },
  };
  const result = await new WorkflowParticipantAssignmentGateEvaluator(assignments)
    .evaluate(context(stage([' approver ', 'approver'])));

  assert.deepEqual(requested, ['approver']);
  assert.equal(result.allowed, false);
  assert.equal(result.blockers[0]?.kind, 'ASSIGNMENT');
  assert.equal(result.blockers[0]?.code, 'WORKFLOW_PARTICIPANT_UNAVAILABLE');
});
