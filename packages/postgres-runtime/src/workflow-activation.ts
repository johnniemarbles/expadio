import type {
  WorkflowActivationCommitResult,
  WorkflowActivationRecord,
  WorkflowActivationRepository,
  WorkflowActivationVerificationState,
  WorkflowProvisioningModel,
} from '@expadio/workflow';
import type { PostgresClient } from './index.ts';

interface ActivationRow {
  readonly activation_id: string;
  readonly tenant_id: string;
  readonly instance_id: string;
  readonly work_type_key: string;
  readonly blueprint_key: string;
  readonly blueprint_version: number;
  readonly provisioning_model: WorkflowProvisioningModel;
  readonly source_rights_grant_ids: readonly string[];
  readonly verification_state: WorkflowActivationVerificationState;
  readonly provisioned_resource_refs: readonly string[];
  readonly started_at: Date | string | null;
  readonly completed_at: Date | string | null;
  readonly verified_by_subject_id: string | null;
  readonly verified_at: Date | string | null;
  readonly verification_evidence_refs: readonly string[];
}

const SELECT_COLUMNS = `activation_id, tenant_id, instance_id, work_type_key,
  blueprint_key, blueprint_version, provisioning_model,
  source_rights_grant_ids, verification_state, provisioned_resource_refs,
  started_at, completed_at, verified_by_subject_id, verified_at,
  verification_evidence_refs`;

/**
 * PostgreSQL implementation of the immutable activation repository port.
 * The caller must bind the verified tenant RLS context before use.
 */
export class PostgresWorkflowActivationRepository
  implements WorkflowActivationRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async find(input: {
    readonly tenantId: string;
    readonly activationId: string;
  }): Promise<WorkflowActivationRecord | null> {
    const result = await this.#client.query<ActivationRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM platform.workflow_activations
        WHERE tenant_id = $1::uuid
          AND activation_id = $2::uuid
        LIMIT 1`,
      [input.tenantId, input.activationId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapActivation(row);
  }

  async record(
    activation: WorkflowActivationRecord,
  ): Promise<WorkflowActivationCommitResult> {
    const inserted = await this.#client.query<ActivationRow>(
      `INSERT INTO platform.workflow_activations (
         activation_id, tenant_id, instance_id, work_type_key,
         blueprint_key, blueprint_version, provisioning_model,
         source_rights_grant_ids, verification_state,
         provisioned_resource_refs, started_at, completed_at,
         verified_by_subject_id, verified_at, verification_evidence_refs
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4,
         $5, $6, $7, $8::uuid[], $9,
         $10::text[], $11::timestamptz, $12::timestamptz,
         $13, $14::timestamptz, $15::text[]
       )
       ON CONFLICT DO NOTHING
       RETURNING ${SELECT_COLUMNS}`,
      [
        activation.activationId,
        activation.tenantId,
        activation.instanceId,
        activation.workTypeKey,
        activation.blueprintKey,
        activation.blueprintVersion,
        activation.provisioningModel,
        [...activation.sourceRightsGrantIds],
        activation.verificationState,
        [...activation.provisionedResourceRefs],
        activation.startedAt ?? null,
        activation.completedAt ?? null,
        activation.verifiedBySubjectId ?? null,
        activation.verifiedAt ?? null,
        [...activation.verificationEvidenceRefs],
      ],
    );

    const row = inserted.rows[0];
    if (row !== undefined) {
      return { status: 'COMMITTED', activation: mapActivation(row) };
    }

    const existing = await this.find({
      tenantId: activation.tenantId,
      activationId: activation.activationId,
    });
    if (existing === null) {
      throw new Error('WORKFLOW_ACTIVATION_CONFLICT_WITHOUT_EXISTING');
    }

    return isExactReplay(existing, activation)
      ? { status: 'ALREADY_RECORDED', activation: existing }
      : { status: 'CONFLICT', existing };
  }
}

function mapActivation(row: ActivationRow): WorkflowActivationRecord {
  return {
    tenantId: row.tenant_id,
    instanceId: row.instance_id,
    workTypeKey: row.work_type_key,
    activationId: row.activation_id,
    blueprintKey: row.blueprint_key,
    blueprintVersion: row.blueprint_version,
    provisioningModel: row.provisioning_model,
    sourceRightsGrantIds: [...row.source_rights_grant_ids],
    verificationState: row.verification_state,
    provisionedResourceRefs: [...row.provisioned_resource_refs],
    ...(row.started_at === null ? {} : { startedAt: toIsoString(row.started_at) }),
    ...(row.completed_at === null ? {} : { completedAt: toIsoString(row.completed_at) }),
    ...(row.verified_by_subject_id === null
      ? {}
      : { verifiedBySubjectId: row.verified_by_subject_id }),
    ...(row.verified_at === null ? {} : { verifiedAt: toIsoString(row.verified_at) }),
    verificationEvidenceRefs: [...row.verification_evidence_refs],
  };
}

function isExactReplay(
  left: WorkflowActivationRecord,
  right: WorkflowActivationRecord,
): boolean {
  return JSON.stringify(canonicalActivation(left))
    === JSON.stringify(canonicalActivation(right));
}

function canonicalActivation(
  activation: WorkflowActivationRecord,
): Record<string, unknown> {
  return {
    ...activation,
    sourceRightsGrantIds: [...activation.sourceRightsGrantIds],
    provisionedResourceRefs: [...activation.provisionedResourceRefs],
    verificationEvidenceRefs: [...activation.verificationEvidenceRefs],
    ...(activation.startedAt === undefined
      ? {}
      : { startedAt: new Date(activation.startedAt).toISOString() }),
    ...(activation.completedAt === undefined
      ? {}
      : { completedAt: new Date(activation.completedAt).toISOString() }),
    ...(activation.verifiedAt === undefined
      ? {}
      : { verifiedAt: new Date(activation.verifiedAt).toISOString() }),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
