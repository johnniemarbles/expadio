import assert from 'node:assert/strict';
import test from 'node:test';
import {
  instantiateWorkflowBlueprint,
  type WorkflowBlueprintDefinition,
} from '../src/index.ts';

const blueprint: WorkflowBlueprintDefinition = {
  blueprintKey: 'partner-onboarding',
  version: 7,
  label: 'Partner onboarding',
  workTypeKey: 'partner-onboarding',
  source: 'PLATFORM',
  state: 'ACTIVE',
  allowsStageAddition: true,
  allowsStageReorder: true,
  allowsStageDeactivation: true,
  minimumRequiredStageKeys: ['qualification'],
  stages: [
    {
      stageKey: 'decision',
      label: 'Decision',
      sequence: 20,
      kind: 'DECISION',
      isMandatory: true,
      canBeDeactivated: false,
      isParallel: false,
      requiredParticipantKeys: ['approver'],
      decisionRequired: true,
      decisionOutcomes: ['APPROVED', 'REJECTED'],
      entryConditions: [],
      exitConditions: [],
      blockingRequirementKeys: [],
      autoAdvance: false,
      onReject: 'TERMINATE',
    },
    {
      stageKey: 'qualification',
      label: 'Qualification',
      sequence: 10,
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
  ],
};

test('pins blueprint identity, scope, and normalizes default sequence deterministically', () => {
  const instance = instantiateWorkflowBlueprint({ blueprint });

  assert.equal(instance.blueprintKey, 'partner-onboarding');
  assert.equal(instance.version, 7);
  assert.equal(instance.scope, 'PLATFORM');
  assert.deepEqual(instance.stages.map((stage) => stage.stageKey), ['qualification', 'decision']);
  assert.deepEqual(instance.stages.map((stage) => stage.sequence), [0, 1]);
});

test('applies an exact custom order and renumbers stages', () => {
  const instance = instantiateWorkflowBlueprint({
    blueprint,
    order: ['decision', 'qualification'],
  });

  assert.deepEqual(instance.stages.map((stage) => stage.stageKey), ['decision', 'qualification']);
  assert.deepEqual(instance.stages.map((stage) => stage.sequence), [0, 1]);
});

test('rejects incomplete, duplicate, or unknown custom order', () => {
  assert.throws(
    () => instantiateWorkflowBlueprint({ blueprint, order: ['qualification'] }),
    /WORKFLOW_BLUEPRINT_ORDER_INVALID/,
  );
  assert.throws(
    () => instantiateWorkflowBlueprint({ blueprint, order: ['qualification', 'qualification'] }),
    /WORKFLOW_BLUEPRINT_ORDER_INVALID/,
  );
  assert.throws(
    () => instantiateWorkflowBlueprint({ blueprint, order: ['qualification', 'unknown'] }),
    /WORKFLOW_BLUEPRINT_ORDER_INVALID/,
  );
});
