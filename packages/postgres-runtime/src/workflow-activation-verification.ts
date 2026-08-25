import type {
  WorkflowActivationVerificationAssessment,
  WorkflowActivationVerificationCommitResult,
  WorkflowActivationVerificationRecord,
  WorkflowActivationVerificationRepository,
} from '@expadio/workflow';
import type { PostgresClient } from './index.ts';

interface VerificationRow {
  readonly verification_id: string;
  readonly tenant_id: string;
  readonly instance_id: string;
  readonly activation_id: string;
  readonly state: WorkflowActivationVerificationRecord['state'];
  readonly assessments: readonly WorkflowActivationVerificationAssessment[];
  readonly verified_by_subject_id: string;
  readonly verified_at: Date | string;
  readonly reason: string;
  readonly evidence_refs: readonly string[];
}

const SELECT_COLUMNS = `verification_id, tenant_id, instance_id, activation_id,
  state, assessments, verified_by_subject_id, verified_at, reason, evidence_refs`;

/** PostgreSQL adapter for append-only activation verification facts. */
export class PostgresWorkflowActivationVerificationRepository
  implements WorkflowActivationVerificationRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async find(input: {
    readonly tenantId: string;
    readonly verificationId: string;
  }): Promise<WorkflowActivationVerificationRecord | null> {
    const result = await this.#client.query<VerificationRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM platform.workflow_activation_verifications
        WHERE tenant_id = $1::uuid
          AND verification_id = $2::uuid
        LIMIT 1`,
      [input.tenantId, input.verificationId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapVerification(row);
  }

  async record(
    verification: WorkflowActivationVerificationRecord,
  ): Promise<WorkflowActivationVerificationCommitResult> {
    const inserted = await this.#client.query<VerificationRow>(
      `INSERT INTO platform.workflow_activation_verifications (
         verification_id, tenant_id, instance_id, activation_id, state,
         assessments, verified_by_subject_id, verified_at, reason, evidence_refs
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
         $6::jsonb, $7, $8::timestamptz, $9, $10::text[]
       )
       ON CONFLICT DO NOTHING
       RETURNING ${SELECT_COLUMNS}`,
      [
        verification.verificationId,
        verification.tenantId,
        verification.instanceId,
        verification.activationId,
        verification.state,
        JSON.stringify(verification.assessments),
        verification.verifiedBySubjectId,
        verification.verifiedAt,
        verification.reason,
        [...verification.evidenceRefs],
      ],
    );

    const row = inserted.rows[0];
    if (row !== undefined) {
      return { status: 'COMMITTED', verification: mapVerification(row) };
    }

    const existing = await this.find({
      tenantId: verification.tenantId,
      verificationId: verification.verificationId,
    });
    if (existing === null) {
      throw new Error('WORKFLOW_ACTIVATION_VERIFICATION_CONFLICT_WITHOUT_EXISTING');
    }

    return isExactReplay(existing, verification)
      ? { status: 'ALREADY_RECORDED', verification: existing }
      : { status: 'CONFLICT', existing };
  }
}

function mapVerification(row: VerificationRow): WorkflowActivationVerificationRecord {
  return {
    verificationId: row.verification_id,
    tenantId: row.tenant_id,
    instanceId: row.instance_id,
    activationId: row.activation_id,
    state: row.state,
    assessments: row.assessments.map((assessment) => ({
      ...assessment,
      evidenceRefs: [...assessment.evidenceRefs],
    })),
    verifiedBySubjectId: row.verified_by_subject_id,
    verifiedAt: toIsoString(row.verified_at),
    reason: row.reason,
    evidenceRefs: [...row.evidence_refs],
  };
}

function isExactReplay(
  left: WorkflowActivationVerificationRecord,
  right: WorkflowActivationVerificationRecord,
): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function canonical(
  verification: WorkflowActivationVerificationRecord,
): Record<string, unknown> {
  return {
    ...verification,
    assessments: verification.assessments.map((assessment) => ({
      ...assessment,
      evidenceRefs: [...assessment.evidenceRefs],
    })),
    verifiedAt: new Date(verification.verifiedAt).toISOString(),
    evidenceRefs: [...verification.evidenceRefs],
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
