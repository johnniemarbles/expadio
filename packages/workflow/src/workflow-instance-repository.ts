import type {
  WorkflowInstance,
  WorkflowStageTransitionRecord,
} from './index.ts';

export interface WorkflowInstanceCommit {
  readonly expectedRevision: number;
  readonly instance: WorkflowInstance;
  readonly transition: WorkflowStageTransitionRecord;
}

export type WorkflowInstanceCommitResult =
  | {
      readonly committed: true;
      readonly instance: WorkflowInstance;
    }
  | {
      readonly committed: false;
      readonly reason: 'REVISION_CONFLICT' | 'INSTANCE_NOT_FOUND';
    };

/**
 * Persistence boundary for workflow runtime state.
 *
 * `commitTransition` must atomically persist the instance mutation and append
 * its transition record only when the stored revision equals expectedRevision.
 */
export interface WorkflowInstanceRepository {
  create(instance: WorkflowInstance): Promise<WorkflowInstance>;

  findById(input: {
    readonly tenantId: string;
    readonly instanceId: string;
  }): Promise<WorkflowInstance | null>;

  commitTransition(commit: WorkflowInstanceCommit): Promise<WorkflowInstanceCommitResult>;
}
