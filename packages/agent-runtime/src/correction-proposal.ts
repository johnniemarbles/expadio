export const CORRECTION_TARGET_BY_CATEGORY = {
  OUTDATED_FACT: 'COMPANY_FACT',
  STRATEGIC_MISALIGNMENT: 'ADR',
  POLICY_VIOLATION: 'POLICY',
  PROCEDURAL_FAILURE: 'SKILL',
  CAPABILITY_DRIFT: 'WORKER',
  DANGEROUS_ACTION: 'MECHANICAL_GATE',
} as const;

export type CorrectionCategory = keyof typeof CORRECTION_TARGET_BY_CATEGORY;
export type CorrectionTargetKind =
  (typeof CORRECTION_TARGET_BY_CATEGORY)[CorrectionCategory];

export interface CompanyBrainCorrectionProposal {
  readonly proposalReference: string;
  readonly tenantId: string;
  readonly executionId: string;
  readonly proposerSubjectId: string;
  readonly agentId: string;
  readonly category: CorrectionCategory;
  readonly targetKind: CorrectionTargetKind;
  readonly targetReference: string;
  readonly originalOutputReference: string;
  readonly originalOutputDigest: string;
  readonly proposedCorrectionReference: string;
  readonly proposedCorrectionDigest: string;
  readonly reasonKey: string;
  readonly status: 'UNREVIEWED';
  readonly createdAt: string;
  readonly correlationId: string;
  readonly evidenceRefs: readonly string[];
}

export interface CompanyBrainCorrectionProposalRepository {
  record(proposal: CompanyBrainCorrectionProposal): Promise<{
    readonly recorded: boolean;
    readonly proposal: CompanyBrainCorrectionProposal;
  }>;
  findByReference(
    tenantId: string,
    proposalReference: string,
  ): Promise<CompanyBrainCorrectionProposal | undefined>;
}

export type CorrectionReviewRoute =
  | 'BUSINESS_CONFIGURATION_REVIEW'
  | 'MECHANICAL_GATE_REVIEW';

export class CorrectionProposalError extends Error {
  readonly code:
    | 'CORRECTION_PROPOSAL_INVALID'
    | 'CORRECTION_TARGET_MISMATCH'
    | 'CORRECTION_RAW_CONTENT_FORBIDDEN';

  constructor(code: CorrectionProposalError['code'], message: string) {
    super(message);
    this.name = 'CorrectionProposalError';
    this.code = code;
  }
}

export function validateCompanyBrainCorrectionProposal(
  proposal: CompanyBrainCorrectionProposal,
): void {
  const allowed = new Set([
    'proposalReference', 'tenantId', 'executionId', 'proposerSubjectId',
    'agentId', 'category', 'targetKind', 'targetReference',
    'originalOutputReference', 'originalOutputDigest',
    'proposedCorrectionReference', 'proposedCorrectionDigest', 'reasonKey',
    'status', 'createdAt', 'correlationId', 'evidenceRefs',
  ]);
  if (Object.keys(proposal).some((key) => !allowed.has(key))) {
    throw new CorrectionProposalError(
      'CORRECTION_RAW_CONTENT_FORBIDDEN',
      'Correction proposals are reference-only and reject undeclared content fields.',
    );
  }
  const stableValues = [
    proposal.proposalReference, proposal.tenantId, proposal.executionId,
    proposal.proposerSubjectId, proposal.agentId, proposal.targetReference,
    proposal.originalOutputReference, proposal.proposedCorrectionReference,
    proposal.reasonKey, proposal.correlationId,
  ];
  if (
    stableValues.some((value) => !stable(value))
    || !digest(proposal.originalOutputDigest)
    || !digest(proposal.proposedCorrectionDigest)
    || proposal.originalOutputDigest === proposal.proposedCorrectionDigest
    || proposal.originalOutputReference === proposal.proposedCorrectionReference
    || proposal.status !== 'UNREVIEWED'
    || !instant(proposal.createdAt)
    || proposal.evidenceRefs.length === 0
    || proposal.evidenceRefs.some((value) => !stable(value))
  ) {
    throw new CorrectionProposalError(
      'CORRECTION_PROPOSAL_INVALID',
      'Correction proposals require governed identities, distinct references and digests, time, correlation, and evidence.',
    );
  }
  if (CORRECTION_TARGET_BY_CATEGORY[proposal.category] !== proposal.targetKind) {
    throw new CorrectionProposalError(
      'CORRECTION_TARGET_MISMATCH',
      'Correction category must route to its governed target type.',
    );
  }
}

export function correctionReviewRoute(
  proposal: CompanyBrainCorrectionProposal,
): CorrectionReviewRoute {
  validateCompanyBrainCorrectionProposal(proposal);
  return proposal.targetKind === 'MECHANICAL_GATE'
    ? 'MECHANICAL_GATE_REVIEW'
    : 'BUSINESS_CONFIGURATION_REVIEW';
}

function stable(value: string): boolean {
  return value.trim() !== '' && value === value.trim() && !/[\r\n\t]/u.test(value);
}

function digest(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}

function instant(value: string): boolean {
  return stable(value) && Number.isFinite(Date.parse(value));
}
