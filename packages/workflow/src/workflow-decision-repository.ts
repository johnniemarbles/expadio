import type {
  WorkflowStageDecision,
  WorkflowStageDecisionContext,
  WorkflowStageDecisionProvider,
} from './workflow-decision.ts';

export interface WorkflowStageDecisionRecord extends WorkflowStageDecisionContext {
  readonly decisionId: string;
  readonly outcome: string;
  readonly decidedBySubjectId: string;
  readonly decidedAt: string;
  readonly code: string;
  readonly evidenceRefs: readonly string[];
}

export type WorkflowStageDecisionCommitResult =
  | {
      readonly status: 'COMMITTED';
      readonly decision: WorkflowStageDecision;
    }
  | {
      /** Exact replay of the already-recorded decision. */
      readonly status: 'ALREADY_RECORDED';
      readonly decision: WorkflowStageDecision;
    }
  | {
      /** The stage already contains a different immutable decision. */
      readonly status: 'CONFLICT';
      readonly existing: WorkflowStageDecision;
    };

/**
 * Persistence boundary for immutable workflow-stage decisions.
 *
 * A tenant/instance/stage may acquire one recorded decision. Exact retries are
 * idempotent; a different decision for the same stage is a conflict rather
 * than an overwrite. Approval chains and authority evaluation occur before
 * this repository is called and remain separate from storage.
 */
export interface WorkflowStageDecisionRepository extends WorkflowStageDecisionProvider {
  record(
    input: WorkflowStageDecisionRecord,
  ): Promise<WorkflowStageDecisionCommitResult>;
}
