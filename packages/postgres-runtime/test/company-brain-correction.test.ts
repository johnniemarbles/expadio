import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompanyBrainCorrectionProposal } from '@expadio/agent-runtime';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import { PostgresCompanyBrainCorrectionProposalRepository } from '../src/company-brain-correction.ts';

class Client implements PostgresClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly steps: Array<SqlQueryResult | Error> = [];
  async query<Row = Record<string, unknown>>(text: string, values: readonly unknown[] = []) {
    this.calls.push({ text, values });
    const step = this.steps.shift() ?? { rows: [], rowCount: 0 };
    if (step instanceof Error) throw step;
    return step as SqlQueryResult<Row>;
  }
}

const proposal: CompanyBrainCorrectionProposal = {
  proposalReference: 'correction://proposal/1',
  tenantId: '41000000-0000-0000-0000-000000000001',
  executionId: 'execution-1', proposerSubjectId: 'subject-1', agentId: 'agent-1',
  category: 'OUTDATED_FACT', targetKind: 'COMPANY_FACT',
  targetReference: 'knowledge://fact/1', originalOutputReference: 'agent-output://1',
  originalOutputDigest: `sha256:${'a'.repeat(64)}`,
  proposedCorrectionReference: 'correction-delta://1',
  proposedCorrectionDigest: `sha256:${'b'.repeat(64)}`,
  reasonKey: 'SOURCE_SUPERSEDED', status: 'UNREVIEWED',
  createdAt: '2026-08-26T00:00:00.000Z',
  correlationId: '41100000-0000-0000-0000-000000000001',
  evidenceRefs: ['evidence://1'],
};

const row = () => ({
  proposal_reference: proposal.proposalReference, tenant_id: proposal.tenantId,
  execution_id: proposal.executionId, proposer_subject_id: proposal.proposerSubjectId,
  agent_id: proposal.agentId, category: proposal.category, target_kind: proposal.targetKind,
  target_reference: proposal.targetReference,
  original_output_reference: proposal.originalOutputReference,
  original_output_digest: proposal.originalOutputDigest,
  proposed_correction_reference: proposal.proposedCorrectionReference,
  proposed_correction_digest: proposal.proposedCorrectionDigest,
  reason_key: proposal.reasonKey, status: proposal.status,
  created_at: proposal.createdAt, correlation_id: proposal.correlationId,
  evidence_refs: proposal.evidenceRefs,
});

test('records a validated reference-only correction proposal', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 1 });
  const result = await new PostgresCompanyBrainCorrectionProposalRepository(client).record(proposal);
  assert.equal(result.recorded, true);
  assert.match(client.calls[0]?.text ?? '', /company_brain_correction_proposals/);
  assert.equal(client.calls[0]?.values.includes('protected-payload'), false);
});

test('loads an exact tenant-scoped proposal', async () => {
  const client = new Client();
  client.steps.push({ rows: [row()], rowCount: 1 });
  const loaded = await new PostgresCompanyBrainCorrectionProposalRepository(client)
    .findByReference(proposal.tenantId, proposal.proposalReference);
  assert.deepEqual(loaded, proposal);
  assert.match(client.calls[0]?.text ?? '', /tenant_id = \$1::uuid/);
});

test('treats an exact retry as already recorded', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 }, { rows: [row()], rowCount: 1 });
  const result = await new PostgresCompanyBrainCorrectionProposalRepository(client).record(proposal);
  assert.equal(result.recorded, false);
  assert.deepEqual(result.proposal, proposal);
});

test('rejects a conflicting retry', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 }, { rows: [row()], rowCount: 1 });
  await assert.rejects(
    new PostgresCompanyBrainCorrectionProposalRepository(client).record({
      ...proposal, reasonKey: 'DIFFERENT_REASON',
    }),
    /CORRECTION_PROPOSAL_IDEMPOTENCY_CONFLICT/,
  );
});
