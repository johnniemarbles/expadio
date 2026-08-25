import type {
  WorkflowActivationVerificationDimension,
  WorkflowActivationVerificationRequest,
} from './workflow-activation-verification.ts';

export type WorkflowActivationVerificationIssueCode =
  | 'ACTIVATION_VERIFICATION_ID_REQUIRED'
  | 'ACTIVATION_VERIFIER_REQUIRED'
  | 'ACTIVATION_VERIFIED_AT_INVALID'
  | 'ACTIVATION_VERIFICATION_REASON_REQUIRED'
  | 'ACTIVATION_VERIFICATION_EVIDENCE_REQUIRED'
  | 'ACTIVATION_VERIFICATION_DIMENSION_MISSING'
  | 'ACTIVATION_VERIFICATION_DIMENSION_DUPLICATE'
  | 'ACTIVATION_VERIFICATION_ASSESSMENT_REASON_REQUIRED'
  | 'ACTIVATION_VERIFICATION_ASSESSMENT_EVIDENCE_REQUIRED';

export interface WorkflowActivationVerificationIssue {
  readonly code: WorkflowActivationVerificationIssueCode;
  readonly field: string;
  readonly message: string;
}

export interface WorkflowActivationVerificationValidationResult {
  readonly valid: boolean;
  readonly issues: readonly WorkflowActivationVerificationIssue[];
}

const REQUIRED_DIMENSIONS: readonly WorkflowActivationVerificationDimension[] = [
  'AGREEMENT',
  'RIGHTS',
  'ACCESS',
  'COMPLIANCE',
  'OPERATIONAL_READINESS',
];

/** Pure verification-pack validation; performs no persistence or provisioning. */
export function validateWorkflowActivationVerification(
  request: WorkflowActivationVerificationRequest,
): WorkflowActivationVerificationValidationResult {
  const issues: WorkflowActivationVerificationIssue[] = [];

  requiredText(request.verificationId, 'verificationId', 'ACTIVATION_VERIFICATION_ID_REQUIRED', issues);
  requiredText(request.verifiedBySubjectId, 'verifiedBySubjectId', 'ACTIVATION_VERIFIER_REQUIRED', issues);
  requiredText(request.reason, 'reason', 'ACTIVATION_VERIFICATION_REASON_REQUIRED', issues);

  if (!Number.isFinite(Date.parse(request.verifiedAt))) {
    issues.push(issue(
      'ACTIVATION_VERIFIED_AT_INVALID',
      'verifiedAt',
      'Verification verifiedAt must be a valid instant.',
    ));
  }

  if (!hasEvidence(request.evidenceRefs)) {
    issues.push(issue(
      'ACTIVATION_VERIFICATION_EVIDENCE_REQUIRED',
      'evidenceRefs',
      'Verification requires at least one non-empty evidence reference.',
    ));
  }

  for (const dimension of REQUIRED_DIMENSIONS) {
    const matches = request.assessments.filter((entry) => entry.dimension === dimension);
    if (matches.length === 0) {
      issues.push(issue(
        'ACTIVATION_VERIFICATION_DIMENSION_MISSING',
        'assessments',
        `Verification assessment ${dimension} is required.`,
      ));
      continue;
    }
    if (matches.length > 1) {
      issues.push(issue(
        'ACTIVATION_VERIFICATION_DIMENSION_DUPLICATE',
        'assessments',
        `Verification assessment ${dimension} must appear exactly once.`,
      ));
    }
  }

  for (const assessment of request.assessments) {
    if (assessment.reason.trim() === '') {
      issues.push(issue(
        'ACTIVATION_VERIFICATION_ASSESSMENT_REASON_REQUIRED',
        'assessments',
        `Verification assessment ${assessment.dimension} requires a reason.`,
      ));
    }
    if (
      assessment.outcome !== 'NOT_APPLICABLE'
      && !hasEvidence(assessment.evidenceRefs)
    ) {
      issues.push(issue(
        'ACTIVATION_VERIFICATION_ASSESSMENT_EVIDENCE_REQUIRED',
        'assessments',
        `Verification assessment ${assessment.dimension} requires evidence.`,
      ));
    }
  }

  return { valid: issues.length === 0, issues };
}

function requiredText(
  value: string,
  field: string,
  code: WorkflowActivationVerificationIssueCode,
  issues: WorkflowActivationVerificationIssue[],
): void {
  if (value.trim() === '') {
    issues.push(issue(code, field, `Verification ${field} is required.`));
  }
}

function hasEvidence(refs: readonly string[]): boolean {
  return refs.length > 0 && refs.every((entry) => entry.trim() !== '');
}

function issue(
  code: WorkflowActivationVerificationIssueCode,
  field: string,
  message: string,
): WorkflowActivationVerificationIssue {
  return { code, field, message };
}
