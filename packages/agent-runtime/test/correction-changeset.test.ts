import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CorrectionChangesetError,
  prepareApprovedCorrectionChangeset,
  type CompanyBrainCorrectionProposal,
  type CorrectionReviewDecision,
} from '../src/index.ts';

const proposal: CompanyBrainCorrectionProposal = {
  proposalReference: 'correction://proposal/1', tenantId: 'tenant-1',
  executionId: 'execution-1', proposerSubjectId: 'author-1', agentId: 'agent-1',
  category: 'OUTDATED_FACT', targetKind: 'COMPANY_FACT',
  targetReference: 'knowledge://fact/1', originalOutputReference: 'output://1',
  originalOutputDigest: `sha256:${'a'.repeat(64)}`,
  proposedCorrectionReference: 'delta://1',
  proposedCorrectionDigest: `sha256:${'b'.repeat(64)}`,
  reasonKey: 'SOURCE_SUPERSEDED', status: 'UNREVIEWED',
  createdAt: '2026-08-26T00:00:00.000Z', correlationId: 'correlation-1',
  evidenceRefs: ['evidence://proposal/1'],
};
const decision: CorrectionReviewDecision = {
  decisionId: 'decision-1', proposalReference: proposal.proposalReference,
  tenantId: proposal.tenantId, reviewerSubjectId: 'reviewer-1', status: 'APPROVED',
  reason: 'Verified against the superseding source.',
  decidedAt: '2026-08-26T00:05:00.000Z', evidenceRefs: ['evidence://review/1'],
};
const input = {
  changesetId: 'changeset-1', expectedBaseRevision: 4,
  configurationKey: 'company-profile-fact', configurationVersion: 5,
  label: 'Correct company profile fact',
};

test('creates a draft reference-only configuration changeset after human review', () => {
  const changeset = prepareApprovedCorrectionChangeset(proposal, decision, input);
  assert.equal(changeset.changes[0]?.kind, 'COMPANY_FACT');
  assert.equal(changeset.changes[0]?.state, 'DRAFT');
  assert.deepEqual(changeset.evidenceRefs, [
    'evidence://proposal/1', 'evidence://review/1',
  ]);
  assert.equal('rawContent' in (changeset.changes[0]?.payload ?? {}), false);
});

test('denies self-review and rejected corrections', () => {
  assert.throws(
    () => prepareApprovedCorrectionChangeset(proposal, {
      ...decision, reviewerSubjectId: proposal.proposerSubjectId,
    }, input),
    (error) => error instanceof CorrectionChangesetError
      && error.code === 'CORRECTION_SELF_REVIEW_DENIED',
  );
  assert.throws(
    () => prepareApprovedCorrectionChangeset(proposal, {
      ...decision, status: 'REJECTED',
    }, input),
    (error) => error instanceof CorrectionChangesetError
      && error.code === 'CORRECTION_REJECTED',
  );
});

test('routes dangerous actions away from configuration publication', () => {
  assert.throws(
    () => prepareApprovedCorrectionChangeset({
      ...proposal, category: 'DANGEROUS_ACTION', targetKind: 'MECHANICAL_GATE',
    }, decision, input),
    (error) => error instanceof CorrectionChangesetError
      && error.code === 'CORRECTION_MECHANICAL_GATE_REQUIRED',
  );
});

test('rejects review identity drift', () => {
  assert.throws(
    () => prepareApprovedCorrectionChangeset(proposal, {
      ...decision, tenantId: 'tenant-2',
    }, input),
    (error) => error instanceof CorrectionChangesetError
      && error.code === 'CORRECTION_REVIEW_IDENTITY_MISMATCH',
  );
});
