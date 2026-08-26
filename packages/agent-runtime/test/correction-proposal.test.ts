import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CorrectionProposalError,
  correctionReviewRoute,
  validateCompanyBrainCorrectionProposal,
  type CompanyBrainCorrectionProposal,
} from '../src/correction-proposal.ts';

const proposal: CompanyBrainCorrectionProposal = {
  proposalReference: 'correction://proposal/1', tenantId: 'tenant-1',
  executionId: 'execution-1', proposerSubjectId: 'subject-1', agentId: 'agent-1',
  category: 'OUTDATED_FACT', targetKind: 'COMPANY_FACT',
  targetReference: 'knowledge://fact/1',
  originalOutputReference: 'agent-output://run/1',
  originalOutputDigest: `sha256:${'a'.repeat(64)}`,
  proposedCorrectionReference: 'correction-delta://proposal/1',
  proposedCorrectionDigest: `sha256:${'b'.repeat(64)}`,
  reasonKey: 'SOURCE_SUPERSEDED', status: 'UNREVIEWED',
  createdAt: '2026-08-26T00:00:00.000Z', correlationId: 'correlation-1',
  evidenceRefs: ['evidence://review/1'],
};

test('routes a valid reference-only correction to configuration review', () => {
  assert.doesNotThrow(() => validateCompanyBrainCorrectionProposal(proposal));
  assert.equal(correctionReviewRoute(proposal), 'BUSINESS_CONFIGURATION_REVIEW');
});

test('routes dangerous actions to mechanical gate review', () => {
  assert.equal(correctionReviewRoute({
    ...proposal, category: 'DANGEROUS_ACTION', targetKind: 'MECHANICAL_GATE',
  }), 'MECHANICAL_GATE_REVIEW');
});

test('rejects category and target drift', () => {
  assert.throws(
    () => validateCompanyBrainCorrectionProposal({ ...proposal, targetKind: 'POLICY' }),
    (error) => error instanceof CorrectionProposalError
      && error.code === 'CORRECTION_TARGET_MISMATCH',
  );
});

test('rejects raw protected content and unchanged output', () => {
  assert.throws(
    () => validateCompanyBrainCorrectionProposal({
      ...proposal, rawContent: 'protected payload',
    } as CompanyBrainCorrectionProposal),
    (error) => error instanceof CorrectionProposalError
      && error.code === 'CORRECTION_RAW_CONTENT_FORBIDDEN',
  );
  assert.throws(
    () => validateCompanyBrainCorrectionProposal({
      ...proposal, proposedCorrectionDigest: proposal.originalOutputDigest,
    }),
    (error) => error instanceof CorrectionProposalError
      && error.code === 'CORRECTION_PROPOSAL_INVALID',
  );
});
