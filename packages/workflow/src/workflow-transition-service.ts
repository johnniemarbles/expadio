import type {
  InstantiatedWorkflowBlueprint,
  WorkflowInstance,
  WorkflowStageTransitionRecord,
  WorkflowTransitionGateDecision,
  WorkflowTransitionIntent,
} from './index.ts';

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
