import type { InstantiatedWorkflowBlueprint } from './blueprint-instantiation.ts';
import type { WorkflowTransitionGateEvaluator, WorkflowTransitionGateDecision } from './workflow-gate.ts';
import type { WorkflowInstance, WorkflowStageTransitionRecord, WorkflowTransitionIntent } from './workflow-instance.ts';
import type { WorkflowInstanceRepository } from './workflow-instance-repository.ts';
import { commitWorkflowStageTransition, WorkflowTransitionError } from './workflow-transition.ts';

export interface WorkflowTransitionServiceInput {
  readonly tenantId: string;
  readonly blueprint: InstantiatedWorkflowBlueprint;
  readonly intent: WorkflowTransitionIntent;
}

export type WorkflowTransitionServiceResult =
  | {
      readonly status: 'COMMITTED';
      readonly instance: WorkflowInstance;
      readonly transition: WorkflowStageTransitionRecord;
      readonly gate: WorkflowTransitionGateDecision;
    }
  | {
      readonly status: 'BLOCKED';
      readonly gate: WorkflowTransitionGateDecision;
    }
  | {
      readonly status: 'INSTANCE_NOT_FOUND';
    }
  | {
      readonly status: 'REVISION_CONFLICT';
    }
  | {
      readonly status: 'INVALID';
      readonly code: string;
    };

/**
 * Application-facing workflow stage transition boundary. The implementation
 * must preserve gate evaluation, deterministic transition calculation and
 * optimistic persistence as separate steps with fail-closed outcomes.
 */
export interface WorkflowTransitionService {
  execute(input: WorkflowTransitionServiceInput): Promise<WorkflowTransitionServiceResult>;
}

/** Framework-free orchestration over the workflow domain ports. */
export class RepositoryWorkflowTransitionService implements WorkflowTransitionService {
  readonly #instances: WorkflowInstanceRepository;
  readonly #gates: WorkflowTransitionGateEvaluator;

  constructor(input: {
    readonly instances: WorkflowInstanceRepository;
    readonly gates: WorkflowTransitionGateEvaluator;
  }) {
    this.#instances = input.instances;
    this.#gates = input.gates;
  }

  async execute(input: WorkflowTransitionServiceInput): Promise<WorkflowTransitionServiceResult> {
    const instance = await this.#instances.findById({
      tenantId: input.tenantId,
      instanceId: input.intent.instanceId,
    });
    if (instance === null) return { status: 'INSTANCE_NOT_FOUND' };
    if (instance.revision !== input.intent.expectedRevision) {
      return { status: 'REVISION_CONFLICT' };
    }

    const structuralError = precheck(instance, input.blueprint, input.intent);
    if (structuralError !== null) {
      return { status: 'INVALID', code: structuralError };
    }

    const fromStage = input.intent.fromStageKey === undefined
      ? undefined
      : input.blueprint.stages.find((stage) => stage.stageKey === input.intent.fromStageKey);
    if (input.intent.fromStageKey !== undefined && fromStage === undefined) {
      return { status: 'INVALID', code: 'WORKFLOW_SOURCE_STAGE_NOT_FOUND' };
    }
    const toStage = input.blueprint.stages.find((stage) => stage.stageKey === input.intent.toStageKey);
    if (toStage === undefined) {
      return { status: 'INVALID', code: 'WORKFLOW_TARGET_STAGE_NOT_FOUND' };
    }

    const gate = await this.#gates.evaluate({
      instance,
      blueprint: input.blueprint,
      intent: input.intent,
      ...(fromStage === undefined ? {} : { fromStage }),
      toStage,
    });
    if (!gate.allowed) return { status: 'BLOCKED', gate };

    let calculated: ReturnType<typeof commitWorkflowStageTransition>;
    try {
      calculated = commitWorkflowStageTransition({
        instance,
        blueprint: input.blueprint,
        intent: input.intent,
      });
    } catch (error) {
      if (error instanceof WorkflowTransitionError) {
        return { status: 'INVALID', code: error.code };
      }
      throw error;
    }

    const committed = await this.#instances.commitTransition({
      expectedRevision: input.intent.expectedRevision,
      instance: calculated.instance,
      transition: calculated.record,
    });
    if (!committed.committed) {
      return { status: committed.reason };
    }

    return {
      status: 'COMMITTED',
      instance: committed.instance,
      transition: calculated.record,
      gate,
    };
  }
}

function precheck(
  instance: WorkflowInstance,
  blueprint: InstantiatedWorkflowBlueprint,
  intent: WorkflowTransitionIntent,
): string | null {
  if (instance.state !== 'RUNNING') return 'WORKFLOW_INSTANCE_NOT_RUNNING';
  if (
    instance.blueprint.blueprintKey !== blueprint.blueprintKey
    || instance.blueprint.version !== blueprint.version
    || instance.blueprint.scope !== blueprint.scope
    || instance.workTypeKey !== blueprint.workTypeKey
  ) {
    return 'WORKFLOW_INSTANCE_BLUEPRINT_MISMATCH';
  }
  if (instance.currentStageKey !== intent.fromStageKey) {
    return 'WORKFLOW_INSTANCE_STAGE_MISMATCH';
  }
  return null;
}
