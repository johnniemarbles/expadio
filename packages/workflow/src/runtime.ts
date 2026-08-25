import type { PinnedWorkflowBlueprint } from './index.ts';

export type WorkflowInstanceState =
  | 'PENDING'
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED';

export interface WorkflowInstance {
  readonly instanceId: string;
  readonly tenantId: string;
  readonly workTypeKey: string;
  readonly businessObjectType: string;
  readonly businessObjectId: string;
  readonly blueprint: PinnedWorkflowBlueprint;
  readonly state: WorkflowInstanceState;
  readonly currentStageKey: string | null;
  readonly revision: number;
  readonly startedAt: string | null;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export type WorkflowTransitionAction =
  | 'START'
  | 'ADVANCE'
  | 'RETURN'
  | 'PAUSE'
  | 'RESUME'
  | 'COMPLETE'
  | 'CANCEL';

/**
 * Intent only. The transition engine added later decides whether the requested
 * action is valid for the pinned blueprint and current runtime state.
 */
export interface WorkflowTransitionIntent {
  readonly instanceId: string;
  readonly expectedRevision: number;
  readonly action: WorkflowTransitionAction;
  readonly actorSubjectId: string;
  readonly targetStageKey?: string;
  readonly reason?: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
}

export interface WorkflowTransitionResult {
  readonly instance: WorkflowInstance;
  readonly fromStageKey: string | null;
  readonly toStageKey: string | null;
  readonly action: WorkflowTransitionAction;
  readonly appliedAt: string;
}
