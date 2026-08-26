import type {
  BusinessConfigurationChangeset,
  BusinessConfigurationKind,
  BusinessConfigurationObject,
} from '@expadio/business-config';
import {
  correctionReviewRoute,
  validateCompanyBrainCorrectionProposal,
  type CompanyBrainCorrectionProposal,
  type CorrectionTargetKind,
} from './correction-proposal.ts';

export interface CorrectionReviewDecision {
  readonly decisionId: string;
  readonly proposalReference: string;
  readonly tenantId: string;
  readonly reviewerSubjectId: string;
  readonly status: 'APPROVED' | 'REJECTED';
  readonly reason: string;
  readonly decidedAt: string;
  readonly evidenceRefs: readonly string[];
}

export interface CorrectionChangesetInput {
  readonly changesetId: string;
  readonly expectedBaseRevision: number;
  readonly configurationKey: string;
  readonly configurationVersion: number;
  readonly label: string;
}

export class CorrectionChangesetError extends Error {
  readonly code:
    | 'CORRECTION_REVIEW_INVALID'
    | 'CORRECTION_REVIEW_IDENTITY_MISMATCH'
    | 'CORRECTION_SELF_REVIEW_DENIED'
    | 'CORRECTION_REJECTED'
    | 'CORRECTION_MECHANICAL_GATE_REQUIRED'
    | 'CORRECTION_CHANGESET_INPUT_INVALID';

  constructor(code: CorrectionChangesetError['code'], message: string) {
    super(message);
    this.name = 'CorrectionChangesetError';
    this.code = code;
  }
}

export function prepareApprovedCorrectionChangeset(
  proposal: CompanyBrainCorrectionProposal,
  decision: CorrectionReviewDecision,
  input: CorrectionChangesetInput,
): BusinessConfigurationChangeset {
  validateCompanyBrainCorrectionProposal(proposal);
  validateDecision(decision);
  if (
    decision.tenantId !== proposal.tenantId
    || decision.proposalReference !== proposal.proposalReference
  ) {
    throw new CorrectionChangesetError(
      'CORRECTION_REVIEW_IDENTITY_MISMATCH',
      'Review must match the exact correction proposal and tenant.',
    );
  }
  if (Date.parse(decision.decidedAt) < Date.parse(proposal.createdAt)) {
    throw new CorrectionChangesetError(
      'CORRECTION_REVIEW_INVALID',
      'Correction review cannot predate the proposal.',
    );
  }
  if (decision.reviewerSubjectId === proposal.proposerSubjectId) {
    throw new CorrectionChangesetError(
      'CORRECTION_SELF_REVIEW_DENIED',
      'Correction authors cannot approve their own proposal.',
    );
  }
  if (decision.status !== 'APPROVED') {
    throw new CorrectionChangesetError(
      'CORRECTION_REJECTED',
      'Rejected corrections cannot create a configuration changeset.',
    );
  }
  if (correctionReviewRoute(proposal) !== 'BUSINESS_CONFIGURATION_REVIEW') {
    throw new CorrectionChangesetError(
      'CORRECTION_MECHANICAL_GATE_REQUIRED',
      'Dangerous-action corrections require the mechanical-gate workflow.',
    );
  }
  if (
    !stable(input.changesetId)
    || !Number.isInteger(input.expectedBaseRevision)
    || input.expectedBaseRevision < 0
    || !stable(input.configurationKey)
    || !Number.isInteger(input.configurationVersion)
    || input.configurationVersion < 1
    || !stable(input.label)
  ) {
    throw new CorrectionChangesetError(
      'CORRECTION_CHANGESET_INPUT_INVALID',
      'Changeset identity, base revision, configuration identity, version, and label are required.',
    );
  }

  const configuration: BusinessConfigurationObject = {
    kind: configurationKind(proposal.targetKind),
    key: input.configurationKey,
    version: input.configurationVersion,
    scope: { kind: 'TENANT', tenantId: proposal.tenantId },
    label: input.label,
    state: 'DRAFT',
    payload: {
      correctionProposalReference: proposal.proposalReference,
      targetReference: proposal.targetReference,
      originalOutputReference: proposal.originalOutputReference,
      originalOutputDigest: proposal.originalOutputDigest,
      proposedCorrectionReference: proposal.proposedCorrectionReference,
      proposedCorrectionDigest: proposal.proposedCorrectionDigest,
      approvalDecisionId: decision.decisionId,
    },
    dependencies: [],
    authoredBySubjectId: decision.reviewerSubjectId,
    authoredAt: decision.decidedAt,
  };
  return {
    changesetId: input.changesetId,
    scope: configuration.scope,
    expectedBaseRevision: input.expectedBaseRevision,
    changes: [configuration],
    authoredBySubjectId: decision.reviewerSubjectId,
    authoredAt: decision.decidedAt,
    reason: decision.reason,
    evidenceRefs: [...new Set([...proposal.evidenceRefs, ...decision.evidenceRefs])],
  };
}

function configurationKind(target: CorrectionTargetKind): BusinessConfigurationKind {
  switch (target) {
    case 'COMPANY_FACT': return 'COMPANY_FACT';
    case 'ADR': return 'ADR';
    case 'POLICY': return 'POLICY';
    case 'SKILL': return 'SKILL';
    case 'WORKER': return 'WORKER';
    case 'MECHANICAL_GATE':
      throw new CorrectionChangesetError(
        'CORRECTION_MECHANICAL_GATE_REQUIRED',
        'Mechanical gates require their dedicated review workflow.',
      );
  }
}

function validateDecision(decision: CorrectionReviewDecision): void {
  if (
    !stable(decision.decisionId)
    || !stable(decision.proposalReference)
    || !stable(decision.tenantId)
    || !stable(decision.reviewerSubjectId)
    || !stable(decision.reason)
    || !instant(decision.decidedAt)
    || decision.evidenceRefs.length === 0
    || decision.evidenceRefs.some((value) => !stable(value))
  ) {
    throw new CorrectionChangesetError(
      'CORRECTION_REVIEW_INVALID',
      'Correction review requires identity, reason, time, and evidence.',
    );
  }
}

function stable(value: string): boolean {
  return value.trim() !== '' && value === value.trim() && !/[\r\n\t]/u.test(value);
}

function instant(value: string): boolean {
  return stable(value) && Number.isFinite(Date.parse(value));
}
