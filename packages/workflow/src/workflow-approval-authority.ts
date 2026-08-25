export interface WorkflowAuthorityRequirement {
  readonly dimensionKey: string;
  readonly requiredValue: number;
  readonly unit?: string;
  readonly scopeType?: string;
  readonly scopeEntityId?: string;
}

export interface WorkflowApprovalAuthorityContext {
  readonly tenantId: string;
  readonly instanceId: string;
  readonly workTypeKey: string;
  readonly stageKey: string;
  readonly proposedOutcome: string;
  readonly requestedBySubjectId: string;
  readonly approverSubjectId: string;
  readonly requirements: readonly WorkflowAuthorityRequirement[];
}

export interface WorkflowApprovalAuthoritySnapshot {
  readonly approverSubjectId: string;
  readonly roleKey?: string;
  readonly delegatedFromSubjectId?: string;
  readonly capturedAt: string;
  readonly evidenceRefs: readonly string[];
}

export type WorkflowApprovalAuthorityDecision =
  | {
      readonly allowed: true;
      readonly code: string;
      readonly authority: WorkflowApprovalAuthoritySnapshot;
      readonly sodEvidenceRefs: readonly string[];
    }
  | {
      readonly allowed: false;
      readonly code: string;
      readonly reason: string;
      readonly evidenceRefs: readonly string[];
    };

/**
 * Provider-neutral boundary for determining whether one subject has authority
 * to approve a proposed workflow-stage decision.
 *
 * Implementations may use role authority dimensions, delegation, organization
 * scope, monetary thresholds, territory and separation-of-duties policy. This
 * contract authorizes the approval action only; it does not grant downstream
 * business rights and does not persist the final stage decision.
 */
export interface WorkflowApprovalAuthorityProvider {
  evaluate(
    context: WorkflowApprovalAuthorityContext,
  ): Promise<WorkflowApprovalAuthorityDecision>;
}
