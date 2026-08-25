export type WorkflowActivationVerificationDimension =
  | 'AGREEMENT'
  | 'RIGHTS'
  | 'ACCESS'
  | 'COMPLIANCE'
  | 'OPERATIONAL_READINESS';

export type WorkflowActivationAssessmentOutcome =
  | 'SATISFIED'
  | 'NOT_SATISFIED'
  | 'NOT_APPLICABLE';

export interface WorkflowActivationVerificationAssessment {
  readonly dimension: WorkflowActivationVerificationDimension;
  readonly outcome: WorkflowActivationAssessmentOutcome;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
}

export interface WorkflowActivationVerificationRequest {
  readonly verificationId: string;
  readonly tenantId: string;
  readonly instanceId: string;
  readonly activationId: string;
  readonly assessments: readonly WorkflowActivationVerificationAssessment[];
  readonly verifiedBySubjectId: string;
  readonly verifiedAt: string;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
}

export interface WorkflowActivationVerificationRecord {
  readonly verificationId: string;
  readonly tenantId: string;
  readonly instanceId: string;
  readonly activationId: string;
  readonly state: 'VERIFIED' | 'FAILED';
  readonly assessments: readonly WorkflowActivationVerificationAssessment[];
  readonly verifiedBySubjectId: string;
  readonly verifiedAt: string;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
}

export type WorkflowActivationVerificationResult =
  | { readonly status: 'RECORDED'; readonly verification: WorkflowActivationVerificationRecord }
  | { readonly status: 'ALREADY_RECORDED'; readonly verification: WorkflowActivationVerificationRecord }
  | { readonly status: 'DENIED'; readonly code: string; readonly reason: string; readonly evidenceRefs: readonly string[] }
  | { readonly status: 'CONFLICT'; readonly existing: WorkflowActivationVerificationRecord };

/**
 * Verification is an explicit, evidence-backed operation after activation.
 * It independently evaluates agreement, rights, access, compliance, and
 * operational readiness; activation start never implies successful verification.
 */
export interface WorkflowActivationVerificationService {
  verify(input: WorkflowActivationVerificationRequest): Promise<WorkflowActivationVerificationResult>;
}
