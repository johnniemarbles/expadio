import type {
  WorkflowBlueprintDefinition,
  WorkflowStageDefinition,
  WorkflowStageKind,
} from './index.ts';

export interface WorkflowBlueprintCustomization {
  readonly enabledStageKeys: readonly string[];
  readonly order: readonly string[];
  readonly customStages?: readonly WorkflowStageDefinition[];
}

export interface WorkflowBlueprintValidationPolicy {
  readonly stageKindDependencies?: Readonly<
    Partial<Record<WorkflowStageKind, readonly WorkflowStageKind[]>>
  >;
}

export type WorkflowBlueprintValidationIssueCode =
  | 'STAGE_ADDITION_NOT_ALLOWED'
  | 'REORDER_NOT_ALLOWED'
  | 'REORDER_PAST_DEPENDENCY'
  | 'REMOVED_MANDATORY'
  | 'REQUIRED_STAGE_DISABLED'
  | 'STAGE_DEACTIVATION_NOT_ALLOWED'
  | 'UNKNOWN_STAGE_KEY'
  | 'DUPLICATE_STAGE_KEY';

export interface WorkflowBlueprintValidationIssue {
  readonly stageKey: string;
  readonly code: WorkflowBlueprintValidationIssueCode;
  readonly message: string;
}

export interface WorkflowBlueprintValidationResult {
  readonly ok: boolean;
  readonly issues: readonly WorkflowBlueprintValidationIssue[];
}

export function validateWorkflowBlueprintCustomization(input: {
  readonly blueprint: WorkflowBlueprintDefinition;
  readonly customization: WorkflowBlueprintCustomization;
  readonly policy?: WorkflowBlueprintValidationPolicy;
}): WorkflowBlueprintValidationResult {
  const { blueprint, customization } = input;
  const customStages = customization.customStages ?? [];
  const issues: WorkflowBlueprintValidationIssue[] = [];
  const baseByKey = new Map(blueprint.stages.map((stage) => [stage.stageKey, stage]));
  const customByKey = new Map<string, WorkflowStageDefinition>();

  for (const stage of customStages) {
    if (baseByKey.has(stage.stageKey) || customByKey.has(stage.stageKey)) {
      issues.push({
        stageKey: stage.stageKey,
        code: 'DUPLICATE_STAGE_KEY',
        message: `Stage key "${stage.stageKey}" is already defined.`,
      });
      continue;
    }
    customByKey.set(stage.stageKey, stage);
  }

  if (customStages.length > 0 && !blueprint.allowsStageAddition) {
    issues.push({
      stageKey: 'blueprint',
      code: 'STAGE_ADDITION_NOT_ALLOWED',
      message: 'This blueprint does not allow stage addition.',
    });
  }

  const allByKey = new Map<string, WorkflowStageDefinition>([
    ...baseByKey.entries(),
    ...customByKey.entries(),
  ]);
  const baseOrder = blueprint.stages.map((stage) => stage.stageKey);
  const proposedOrder = customization.order.length > 0 ? customization.order : baseOrder;

  for (const stageKey of proposedOrder) {
    if (!allByKey.has(stageKey)) {
      issues.push({
        stageKey,
        code: 'UNKNOWN_STAGE_KEY',
        message: `Stage key "${stageKey}" is not defined by this blueprint customization.`,
      });
    }
  }

  if (!sameOrder(proposedOrder, baseOrder) && !blueprint.allowsStageReorder) {
    issues.push({
      stageKey: 'blueprint',
      code: 'REORDER_NOT_ALLOWED',
      message: 'This blueprint does not allow stage reordering.',
    });
  }

  const enabled = new Set(customization.enabledStageKeys);
  for (const requiredStageKey of blueprint.minimumRequiredStageKeys) {
    if (!proposedOrder.includes(requiredStageKey)) {
      issues.push({
        stageKey: requiredStageKey,
        code: 'REMOVED_MANDATORY',
        message: `Minimum required stage "${requiredStageKey}" must remain in the blueprint.`,
      });
    }
  }

  for (const stage of blueprint.stages) {
    if (enabled.has(stage.stageKey)) continue;

    if (stage.isMandatory || !stage.canBeDeactivated) {
      issues.push({
        stageKey: stage.stageKey,
        code: 'REQUIRED_STAGE_DISABLED',
        message: `Stage "${stage.stageKey}" is required and cannot be disabled.`,
      });
      continue;
    }

    if (!blueprint.allowsStageDeactivation) {
      issues.push({
        stageKey: stage.stageKey,
        code: 'STAGE_DEACTIVATION_NOT_ALLOWED',
        message: 'This blueprint does not allow stage deactivation.',
      });
    }
  }

  const dependencies = input.policy?.stageKindDependencies ?? {};
  for (const [index, stageKey] of proposedOrder.entries()) {
    const stage = allByKey.get(stageKey);
    if (stage === undefined) continue;
    const requiredKinds = dependencies[stage.kind] ?? [];

    for (const requiredKind of requiredKinds) {
      const dependencyIndex = proposedOrder.findIndex(
        (candidateKey) => allByKey.get(candidateKey)?.kind === requiredKind,
      );
      if (dependencyIndex !== -1 && dependencyIndex > index) {
        issues.push({
          stageKey,
          code: 'REORDER_PAST_DEPENDENCY',
          message: `${stage.kind} stage "${stageKey}" cannot precede ${requiredKind}.`,
        });
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
