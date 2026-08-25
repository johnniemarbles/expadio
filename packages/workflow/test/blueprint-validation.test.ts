import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateWorkflowBlueprintCustomization,
  type WorkflowBlueprintDefinition,
} from '../src/index.ts';

const blueprint: WorkflowBlueprintDefinition = {
  blueprintKey: 'partner-onboarding',
  version: 1,
  label: 'Partner onboarding',
  workTypeKey: 'partner-onboarding',
  source: 'PLATFORM',
  state: 'ACTIVE',
  allowsStageAddition: false,
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
      stageKey: 'review',
      label: 'Review',
      sequence: 1,
      kind: 'REVIEW',
      isMandatory: false,
      canBeDeactivated: true,
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
    {
      stageKey: 'decision',
      label: 'Decision',
      sequence: 2,
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

test('accepts a valid customization without hard-coded business stage dependencies', () => {
  const result = validateWorkflowBlueprintCustomization({
    blueprint,
    customization: {
      enabledStageKeys: ['qualification', 'review', 'decision'],
      order: ['qualification', 'review', 'decision'],
    },
  });

  assert.deepEqual(result, { ok: true, issues: [] });
});

test('rejects disabling a mandatory stage and removing a minimum stage', () => {
  const result = validateWorkflowBlueprintCustomization({
    blueprint,
    customization: {
      enabledStageKeys: ['review', 'decision'],
      order: ['review', 'decision'],
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'REQUIRED_STAGE_DISABLED'));
  assert.ok(result.issues.some((issue) => issue.code === 'REMOVED_MANDATORY'));
});

test('applies dependency ordering only when supplied by policy', () => {
  const result = validateWorkflowBlueprintCustomization({
    blueprint,
    customization: {
      enabledStageKeys: ['qualification', 'review', 'decision'],
      order: ['decision', 'qualification', 'review'],
    },
    policy: {
      stageKindDependencies: {
        DECISION: ['REVIEW'],
      },
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'REORDER_PAST_DEPENDENCY'));
});

test('rejects custom stage addition when the blueprint forbids it', () => {
  const customStage = {
    ...blueprint.stages[1]!,
    stageKey: 'custom-check',
    label: 'Custom check',
    kind: 'CUSTOM' as const,
  };
  const result = validateWorkflowBlueprintCustomization({
    blueprint,
    customization: {
      enabledStageKeys: ['qualification', 'review', 'decision', 'custom-check'],
      order: ['qualification', 'review', 'custom-check', 'decision'],
      customStages: [customStage],
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'STAGE_ADDITION_NOT_ALLOWED'));
});
