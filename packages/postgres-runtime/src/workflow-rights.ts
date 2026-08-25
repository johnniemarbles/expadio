import type {
  WorkflowRightsGrant,
  WorkflowRightsGrantCommitResult,
  WorkflowRightsGrantRepository,
  WorkflowRightsScope,
} from '@expadio/workflow';
import type { PostgresClient } from './index.ts';

interface RightsGrantRow {
  readonly grant_id: string;
  readonly tenant_id: string;
  readonly instance_id: string;
  readonly work_type_key: string;
  readonly beneficiary_subject_id: string | null;
  readonly beneficiary_organization_id: string | null;
  readonly profile_key: string;
  readonly profile_version: number;
  readonly right_types: readonly string[];
  readonly scope: WorkflowRightsScope;
  readonly exclusivity_key: string | null;
  readonly effective_from: Date | string;
  readonly effective_until: Date | string | null;
  readonly source_decision_id: string | null;
  readonly source_agreement_id: string | null;
  readonly execution_verification_id: string | null;
  readonly granted_by_subject_id: string;
  readonly granted_at: Date | string;
  readonly state: WorkflowRightsGrant['state'];
  readonly evidence_refs: readonly string[];
  readonly revoked_at: Date | string | null;
  readonly revoked_by_subject_id: string | null;
  readonly revocation_reason: string | null;
}

const SELECT_COLUMNS = `grant_id, tenant_id, instance_id, work_type_key,
  beneficiary_subject_id, beneficiary_organization_id,
  profile_key, profile_version, right_types, scope, exclusivity_key,
  effective_from, effective_until, source_decision_id, source_agreement_id,
  execution_verification_id, granted_by_subject_id, granted_at, state,
  evidence_refs, revoked_at, revoked_by_subject_id, revocation_reason`;

/**
 * PostgreSQL implementation of the immutable rights-grant repository port.
 * The caller must bind the verified tenant RLS context before use.
 */
export class PostgresWorkflowRightsGrantRepository
  implements WorkflowRightsGrantRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async find(input: {
    readonly tenantId: string;
    readonly grantId: string;
  }): Promise<WorkflowRightsGrant | null> {
    const result = await this.#client.query<RightsGrantRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM platform.workflow_rights_grants
        WHERE tenant_id = $1::uuid
          AND grant_id = $2::uuid
        LIMIT 1`,
      [input.tenantId, input.grantId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapGrant(row);
  }

  async record(grant: WorkflowRightsGrant): Promise<WorkflowRightsGrantCommitResult> {
    const inserted = await this.#client.query<RightsGrantRow>(
      `INSERT INTO platform.workflow_rights_grants (
         grant_id, tenant_id, instance_id, work_type_key,
         beneficiary_subject_id, beneficiary_organization_id,
         profile_key, profile_version, right_types, scope, exclusivity_key,
         effective_from, effective_until, source_decision_id, source_agreement_id,
         execution_verification_id, granted_by_subject_id, granted_at, state,
         evidence_refs, revoked_at, revoked_by_subject_id, revocation_reason
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4,
         $5, $6::uuid,
         $7, $8, $9::text[], $10::jsonb, $11,
         $12::timestamptz, $13::timestamptz, $14, $15,
         $16, $17, $18::timestamptz, $19,
         $20::text[], $21::timestamptz, $22, $23
       )
       ON CONFLICT DO NOTHING
       RETURNING ${SELECT_COLUMNS}`,
      [
        grant.grantId,
        grant.tenantId,
        grant.instanceId,
        grant.workTypeKey,
        grant.beneficiarySubjectId ?? null,
        grant.beneficiaryOrganizationId ?? null,
        grant.profileKey,
        grant.profileVersion,
        [...grant.rightTypes],
        JSON.stringify(grant.scope),
        grant.exclusivityKey ?? null,
        grant.effectiveFrom,
        grant.effectiveUntil ?? null,
        grant.sourceDecisionId ?? null,
        grant.sourceAgreementId ?? null,
        grant.executionVerificationId ?? null,
        grant.grantedBySubjectId,
        grant.grantedAt,
        grant.state,
        [...grant.evidenceRefs],
        grant.revokedAt ?? null,
        grant.revokedBySubjectId ?? null,
        grant.revocationReason ?? null,
      ],
    );

    const row = inserted.rows[0];
    if (row !== undefined) {
      return { status: 'COMMITTED', grant: mapGrant(row) };
    }

    const existing = await this.find({ tenantId: grant.tenantId, grantId: grant.grantId });
    if (existing === null) throw new Error('WORKFLOW_RIGHTS_GRANT_CONFLICT_WITHOUT_EXISTING');

    return isExactReplay(existing, grant)
      ? { status: 'ALREADY_RECORDED', grant: existing }
      : { status: 'CONFLICT', existing };
  }
}

function mapGrant(row: RightsGrantRow): WorkflowRightsGrant {
  return {
    tenantId: row.tenant_id,
    instanceId: row.instance_id,
    workTypeKey: row.work_type_key,
    grantId: row.grant_id,
    ...(row.beneficiary_subject_id === null ? {} : { beneficiarySubjectId: row.beneficiary_subject_id }),
    ...(row.beneficiary_organization_id === null ? {} : { beneficiaryOrganizationId: row.beneficiary_organization_id }),
    profileKey: row.profile_key,
    profileVersion: row.profile_version,
    rightTypes: [...row.right_types],
    scope: structuredClone(row.scope),
    ...(row.exclusivity_key === null ? {} : { exclusivityKey: row.exclusivity_key }),
    effectiveFrom: toIsoString(row.effective_from),
    ...(row.effective_until === null ? {} : { effectiveUntil: toIsoString(row.effective_until) }),
    ...(row.source_decision_id === null ? {} : { sourceDecisionId: row.source_decision_id }),
    ...(row.source_agreement_id === null ? {} : { sourceAgreementId: row.source_agreement_id }),
    ...(row.execution_verification_id === null ? {} : { executionVerificationId: row.execution_verification_id }),
    grantedBySubjectId: row.granted_by_subject_id,
    grantedAt: toIsoString(row.granted_at),
    state: row.state,
    evidenceRefs: [...row.evidence_refs],
    ...(row.revoked_at === null ? {} : { revokedAt: toIsoString(row.revoked_at) }),
    ...(row.revoked_by_subject_id === null ? {} : { revokedBySubjectId: row.revoked_by_subject_id }),
    ...(row.revocation_reason === null ? {} : { revocationReason: row.revocation_reason }),
  };
}

function isExactReplay(left: WorkflowRightsGrant, right: WorkflowRightsGrant): boolean {
  return JSON.stringify(canonicalGrant(left)) === JSON.stringify(canonicalGrant(right));
}

function canonicalGrant(grant: WorkflowRightsGrant): Record<string, unknown> {
  return {
    ...grant,
    rightTypes: [...grant.rightTypes],
    scope: grant.scope,
    evidenceRefs: [...grant.evidenceRefs],
    effectiveFrom: new Date(grant.effectiveFrom).toISOString(),
    ...(grant.effectiveUntil === undefined ? {} : { effectiveUntil: new Date(grant.effectiveUntil).toISOString() }),
    grantedAt: new Date(grant.grantedAt).toISOString(),
    ...(grant.revokedAt === undefined ? {} : { revokedAt: new Date(grant.revokedAt).toISOString() }),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
