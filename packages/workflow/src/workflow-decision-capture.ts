import type { WorkflowAuthorityRequirement } from './workflow-approval-authority.ts';
import type { WorkflowStageDecision } from './workflow-decision.ts';

export interface WorkflowDecisionCaptureInput {
  readonly tenantId: string;
  readonly instanceId: string;
  readonly workTypeKey: string;
  readonly stageKey: string;
  readonly decisionId: string;
  readonly outcome: string;
  readonly requestedBySubjectId: string;
  readonly approverSubjectId: string;
  readonly authorityRequirements: readonly WorkflowAuthorityRequirement[];
  readonly decidedAt: string;
  readonly code: string;
  readonly evidenceRefs: readonly string[];
}

export type WorkflowDecisionCaptureResult =
  | {
      readonly status: 'COMMITTED' | 'ALREADY_RECORDED';
      readonly decision: WorkflowStageDecision;
      readonly authorityCode: string;
      readonly authorityEvidenceRefs: readonly string[];
      readonly sodEvidenceRefs: readonly string[];
    }
  | {
      readonly status: 'AUTHORITY_DENIED';
      readonly code: string;
      readonly reason: string;
      readonly evidenceRefs: readonly string[];
    }
  | {
      readonly status: 'CONFLICT';
      readonly existing: WorkflowStageDecision;
    };

/**
 * Application boundary for recording one workflow-stage decision.
 *
 * Implementations must authorize the approver before attempting immutable
 * persistence. An authority decision permits the decision record only; it does
 * not grant downstream business rights or bypass later workflow gates.
 */
export interface WorkflowDecisionCaptureService {
  capture(input: WorkflowDecisionCaptureInput): Promise<WorkflowDecisionCaptureResult>;
}
