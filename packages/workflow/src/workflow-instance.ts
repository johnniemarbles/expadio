import type { PinnedWorkflowBlueprint } from './index.ts';

export type WorkflowInstanceState =
  | 'CREATED'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

export interface WorkflowSubjectReference {
  readonly type: string;
  readonly id: string;
}

export type WorkflowIndustryPackProvenance =
  | {
      readonly runtimeSource: 'NEUTRAL';
    }
  | {
      readonly runtimeSource: 'CODE_BASELINE';
      readonly verticalKey: string;
      readonly version?: number;
    }
  | {
      readonly runtimeSource: 'TENANT_PUBLISHED' | 'PLATFORM_PUBLISHED';
      readonly verticalKey: string;
      readonly version: number;
    };

export interface WorkflowInstance {
  readonly instanceId: string;
  readonly tenantId: string;
  readonly workTypeKey: string;
  readonly subject: WorkflowSubjectReference;
  readonly blueprint: PinnedWorkflowBlueprint;
  /**
   * Immutable provenance for the business configuration that governed creation
   * of this workflow. Absent only for historical instances created before the
   * provenance contract existed.
   */
  readonly industryPackProvenance?: WorkflowIndustryPackProvenance;
  readonly state: WorkflowInstanceState;
  readonly currentStageKey?: string;
  /** Optimistic-concurrency revision for deterministic transition writes. */
  readonly revision: number;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly updatedAt: string;
}

export interface WorkflowTransitionIntent {
  readonly instanceId: string;
  readonly expectedRevision: number;
  readonly fromStageKey?: string;
  readonly toStageKey: string;
  readonly requestedBySubjectId: string;
  readonly requestedAt: string;
  readonly reason?: string;
}

export interface WorkflowStageTransitionRecord {
  readonly instanceId: string;
  readonly fromStageKey?: string;
  readonly toStageKey: string;
  readonly fromState: WorkflowInstanceState;
  readonly toState: WorkflowInstanceState;
  readonly revision: number;
  readonly transitionedBySubjectId: string;
  readonly transitionedAt: string;
  readonly reason?: string;
}
