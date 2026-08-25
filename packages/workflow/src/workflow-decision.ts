export type WorkflowStageDecisionStatus = 'PENDING' | 'RECORDED';

export interface WorkflowStageDecision {
  readonly stageKey: string;
  readonly status: WorkflowStageDecisionStatus;
  readonly decisionId?: string;
  readonly outcome?: string;
  readonly decidedBySubjectId?: string;
  readonly decidedAt?: string;
  readonly code: string;
  readonly evidenceRefs: readonly string[];
}

export interface WorkflowStageDecisionContext {
  readonly tenantId: string;
  readonly instanceId: string;
  readonly workTypeKey: string;
  readonly stageKey: string;
}

/**
 * Read boundary for the decision recorded against one workflow stage.
 * Decision capture, authority thresholds, approval chains and immutable audit
 * storage are separate mechanisms and remain outside this contract.
 */
export interface WorkflowStageDecisionProvider {
  resolve(
    context: WorkflowStageDecisionContext,
  ): Promise<WorkflowStageDecision | null>;
}
