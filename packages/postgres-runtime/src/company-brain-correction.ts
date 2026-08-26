import {
  validateCompanyBrainCorrectionProposal,
  type CompanyBrainCorrectionProposal,
  type CompanyBrainCorrectionProposalRepository,
  type CorrectionCategory,
  type CorrectionTargetKind,
} from '@expadio/agent-runtime';
import type { PostgresClient } from './index.ts';

interface CorrectionRow {
  readonly proposal_reference: string;
  readonly tenant_id: string;
  readonly execution_id: string;
  readonly proposer_subject_id: string;
  readonly agent_id: string;
  readonly category: CorrectionCategory;
  readonly target_kind: CorrectionTargetKind;
  readonly target_reference: string;
  readonly original_output_reference: string;
  readonly original_output_digest: string;
  readonly proposed_correction_reference: string;
  readonly proposed_correction_digest: string;
  readonly reason_key: string;
  readonly status: 'UNREVIEWED';
  readonly created_at: Date | string;
  readonly correlation_id: string;
  readonly evidence_refs: readonly string[];
}

export class PostgresCompanyBrainCorrectionProposalRepository
implements CompanyBrainCorrectionProposalRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async record(proposal: CompanyBrainCorrectionProposal): Promise<{
    readonly recorded: boolean;
    readonly proposal: CompanyBrainCorrectionProposal;
  }> {
    validateCompanyBrainCorrectionProposal(proposal);
    const result = await this.#client.query(
      `INSERT INTO platform.company_brain_correction_proposals (
         proposal_reference, tenant_id, execution_id, proposer_subject_id,
         agent_id, category, target_kind, target_reference,
         original_output_reference, original_output_digest,
         proposed_correction_reference, proposed_correction_digest,
         reason_key, status, created_at, correlation_id, evidence_refs
       ) VALUES (
         $1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15::timestamptz, $16::uuid, $17::text[]
       ) ON CONFLICT DO NOTHING`,
      values(proposal),
    );
    if (result.rowCount === 1) return { recorded: true, proposal };

    const existing = await this.findByReference(
      proposal.tenantId,
      proposal.proposalReference,
    );
    if (existing === undefined) {
      throw new Error('CORRECTION_PROPOSAL_CONFLICT_WITHOUT_VISIBLE_RECORD');
    }
    if (JSON.stringify(existing) !== JSON.stringify(proposal)) {
      throw new Error('CORRECTION_PROPOSAL_IDEMPOTENCY_CONFLICT');
    }
    return { recorded: false, proposal: existing };
  }

  async findByReference(
    tenantId: string,
    proposalReference: string,
  ): Promise<CompanyBrainCorrectionProposal | undefined> {
    const result = await this.#client.query<CorrectionRow>(
      CORRECTION_SELECT
        + ' WHERE tenant_id = $1::uuid AND proposal_reference = $2 LIMIT 1',
      [tenantId, proposalReference],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : map(row);
  }
}

const CORRECTION_SELECT =
  `SELECT proposal_reference, tenant_id, execution_id, proposer_subject_id,
          agent_id, category, target_kind, target_reference,
          original_output_reference, original_output_digest,
          proposed_correction_reference, proposed_correction_digest,
          reason_key, status, created_at, correlation_id, evidence_refs
     FROM platform.company_brain_correction_proposals`;

function values(proposal: CompanyBrainCorrectionProposal): readonly unknown[] {
  return [
    proposal.proposalReference, proposal.tenantId, proposal.executionId,
    proposal.proposerSubjectId, proposal.agentId, proposal.category,
    proposal.targetKind, proposal.targetReference,
    proposal.originalOutputReference, proposal.originalOutputDigest,
    proposal.proposedCorrectionReference, proposal.proposedCorrectionDigest,
    proposal.reasonKey, proposal.status, proposal.createdAt,
    proposal.correlationId, [...proposal.evidenceRefs],
  ];
}

function map(row: CorrectionRow): CompanyBrainCorrectionProposal {
  return {
    proposalReference: row.proposal_reference,
    tenantId: row.tenant_id,
    executionId: row.execution_id,
    proposerSubjectId: row.proposer_subject_id,
    agentId: row.agent_id,
    category: row.category,
    targetKind: row.target_kind,
    targetReference: row.target_reference,
    originalOutputReference: row.original_output_reference,
    originalOutputDigest: row.original_output_digest,
    proposedCorrectionReference: row.proposed_correction_reference,
    proposedCorrectionDigest: row.proposed_correction_digest,
    reasonKey: row.reason_key,
    status: row.status,
    createdAt: iso(row.created_at),
    correlationId: row.correlation_id,
    evidenceRefs: [...row.evidence_refs],
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
