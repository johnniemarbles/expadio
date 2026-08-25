import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowBlueprintDefinition } from '../src/index.ts';

const blueprint: WorkflowBlueprintDefinition = {
  blueprintKey: 'partner-onboarding',
  version: 1,
  label: 'Partner onboarding',
  workTypeKey: 'partner-onboarding',
  source: 'PLATFORM',
  state: 'ACTIVE',
  allowsStageAddition: true,
  allowsStageReorder: true,
  allowsStageDeactivation: true,
  minimumRequiredStageKeys: ['qualification', 'decision'],
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
      stageKey: 'decision',
      label: 'Decision',
      sequence: 1,
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
  ],
};

test('workflow blueprint contracts are tenant-neutral and explicitly versioned', () => {
  assert.equal(blueprint.source, 'PLATFORM');
  assert.equal(blueprint.version, 1);
  assert.deepEqual(blueprint.minimumRequiredStageKeys, ['qualification', 'decision']);
  assert.equal(blueprint.stages[1]?.kind, 'DECISION');
});
