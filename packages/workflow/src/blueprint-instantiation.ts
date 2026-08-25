import type {
  PinnedWorkflowBlueprint,
  WorkflowBlueprintDefinition,
  WorkflowStageDefinition,
} from './index.ts';

export interface InstantiatedWorkflowBlueprint extends PinnedWorkflowBlueprint {
  readonly workTypeKey: string;
  readonly stages: readonly WorkflowStageDefinition[];
}

export function instantiateWorkflowBlueprint(input: {
  readonly blueprint: WorkflowBlueprintDefinition;
  readonly order?: readonly string[];
}): InstantiatedWorkflowBlueprint {
  const { blueprint } = input;
  const byKey = new Map(blueprint.stages.map((stage) => [stage.stageKey, stage]));
  const defaultOrder = [...blueprint.stages]
    .sort((left, right) => left.sequence - right.sequence)
    .map((stage) => stage.stageKey);
  const order = input.order ?? defaultOrder;

  if (!isExactStageOrder(order, byKey)) {
    throw new Error('WORKFLOW_BLUEPRINT_ORDER_INVALID');
  }

  return {
    blueprintKey: blueprint.blueprintKey,
    version: blueprint.version,
    workTypeKey: blueprint.workTypeKey,
    stages: order.map((stageKey, sequence) => ({
      ...byKey.get(stageKey)!,
      sequence,
    })),
  };
}

function isExactStageOrder(
  order: readonly string[],
  byKey: ReadonlyMap<string, WorkflowStageDefinition>,
): boolean {
  if (order.length !== byKey.size) return false;
  const unique = new Set(order);
  if (unique.size !== order.length) return false;
  return order.every((stageKey) => byKey.has(stageKey));
}
