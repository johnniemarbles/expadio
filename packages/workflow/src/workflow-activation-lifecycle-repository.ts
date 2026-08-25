import type {
  WorkflowActivationLifecycleEvent,
  WorkflowActivationLifecycleState,
} from './workflow-activation-lifecycle.ts';

export type WorkflowActivationLifecycleCommitResult =
  | {
      readonly status: 'COMMITTED';
      readonly event: WorkflowActivationLifecycleEvent;
    }
  | {
      readonly status: 'ALREADY_RECORDED';
      readonly event: WorkflowActivationLifecycleEvent;
    }
  | {
      readonly status: 'EVENT_CONFLICT';
      readonly existing: WorkflowActivationLifecycleEvent;
    }
  | {
      readonly status: 'STATE_CONFLICT';
      readonly currentState: WorkflowActivationLifecycleState;
    };

/**
 * Append-only lifecycle event boundary with an optimistic current-state check.
 * Implementations derive current state from immutable history, never by
 * overwriting the completed workflow case or an earlier activation fact.
 */
export interface WorkflowActivationLifecycleRepository {
  findEvent(input: {
    readonly tenantId: string;
    readonly eventId: string;
  }): Promise<WorkflowActivationLifecycleEvent | null>;

  currentState(input: {
    readonly tenantId: string;
    readonly activationId: string;
  }): Promise<WorkflowActivationLifecycleState | null>;

  append(
    event: WorkflowActivationLifecycleEvent,
  ): Promise<WorkflowActivationLifecycleCommitResult>;
}
