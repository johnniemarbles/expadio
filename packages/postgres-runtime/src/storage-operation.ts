import {
  validateObjectStorageIntent,
  validateObjectStorageObservation,
  type ObjectStorageIntent,
  type ObjectStorageObservation,
  type ObjectStorageOperationRecord,
  type ObjectStorageOperationRepository,
  type RecordObjectStorageOperationResult,
} from '@expadio/storage';
import type { PostgresClient } from './index.ts';

interface StorageOperationRow {
  readonly operation_id: string;
  readonly request_id: string;
  readonly tenant_id: string;
  readonly requested_by_subject_id: string;
  readonly operation: ObjectStorageIntent['operation'];
  readonly purpose: string;
  readonly object_reference: string;
  readonly source_reference: string | null;
  readonly expected_sha256: string | null;
  readonly content_type: string | null;
  readonly retention_policy_key: string;
  readonly retention_policy_version: number;
  readonly required_residency_tags: readonly string[];
  readonly required_compliance_tags: readonly string[];
  readonly deletion_authorization_decision_id: string | null;
  readonly idempotency_key: string;
  readonly requested_at: Date | string;
  readonly status: ObjectStorageObservation['status'];
  readonly content_reference: string | null;
  readonly actual_sha256: string | null;
  readonly connector_key: string;
  readonly provider_key: string;
  readonly region: string;
  readonly completed_at: Date | string;
  readonly correlation_id: string;
  readonly evidence_refs: readonly string[];
  readonly source_references: readonly string[];
}

export class PostgresObjectStorageOperationRepository
implements ObjectStorageOperationRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async record(
    operation: ObjectStorageOperationRecord,
  ): Promise<RecordObjectStorageOperationResult> {
    const intentValidation =
      validateObjectStorageIntent(operation.intent);
    const observationValidation =
      validateObjectStorageObservation(
        operation.intent,
        operation.observation,
      );
    if (
      operation.operationId.trim() === ''
      || !intentValidation.valid
      || !observationValidation.valid
    ) {
      throw new Error('STORAGE_OPERATION_RECORD_INVALID');
    }

    const result = await this.#client.query(
      `INSERT INTO platform.object_storage_operations (
         operation_id, request_id, tenant_id,
         requested_by_subject_id, operation, purpose,
         object_reference, source_reference, expected_sha256,
         content_type, retention_policy_key,
         retention_policy_version, required_residency_tags,
         required_compliance_tags,
         deletion_authorization_decision_id, idempotency_key,
         requested_at, status, content_reference, actual_sha256,
         connector_key, provider_key, region, completed_at,
         correlation_id, evidence_refs, source_references
       ) VALUES (
         $1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9,
         $10, $11, $12, $13::text[], $14::text[], $15, $16,
         $17::timestamptz, $18, $19, $20, $21, $22, $23,
         $24::timestamptz, $25::uuid, $26::text[], $27::text[]
       )
       ON CONFLICT DO NOTHING`,
      values(operation),
    );
    if (result.rowCount === 1) {
      return { recorded: true, operation };
    }

    const existing = await this.findByRequest({
      tenantId: operation.intent.tenantId,
      requestId: operation.intent.requestId,
    });
    if (existing === undefined) {
      throw new Error(
        'STORAGE_OPERATION_CONFLICT_WITHOUT_VISIBLE_RECORD',
      );
    }
    if (!same(existing, operation)) {
      throw new Error('STORAGE_OPERATION_IDEMPOTENCY_CONFLICT');
    }
    return { recorded: false, operation: existing };
  }

  async findByRequest(input: {
    readonly tenantId: string;
    readonly requestId: string;
  }): Promise<ObjectStorageOperationRecord | undefined> {
    const result = await this.#client.query<StorageOperationRow>(
      STORAGE_SELECT
        + ' WHERE tenant_id = $1::uuid AND request_id = $2 LIMIT 1',
      [input.tenantId, input.requestId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : map(row);
  }
}

const STORAGE_SELECT =
  `SELECT operation_id, request_id, tenant_id,
          requested_by_subject_id, operation, purpose,
          object_reference, source_reference, expected_sha256,
          content_type, retention_policy_key,
          retention_policy_version, required_residency_tags,
          required_compliance_tags,
          deletion_authorization_decision_id, idempotency_key,
          requested_at, status, content_reference, actual_sha256,
          connector_key, provider_key, region, completed_at,
          correlation_id, evidence_refs, source_references
     FROM platform.object_storage_operations`;

function values(
  record: ObjectStorageOperationRecord,
): readonly unknown[] {
  const { intent, observation } = record;
  return [
    record.operationId,
    intent.requestId,
    intent.tenantId,
    intent.requestedBySubjectId,
    intent.operation,
    intent.purpose,
    intent.objectReference,
    intent.sourceReference,
    intent.expectedSha256,
    intent.contentType,
    intent.retentionPolicy.key,
    intent.retentionPolicy.version,
    [...intent.requiredResidencyTags],
    [...intent.requiredComplianceTags],
    intent.deletionAuthorizationDecisionId,
    intent.idempotencyKey,
    intent.requestedAt,
    observation.status,
    observation.contentReference,
    observation.sha256,
    observation.connectorKey,
    observation.providerKey,
    observation.region,
    observation.completedAt,
    intent.correlationId,
    [...intent.evidenceRefs],
    [...observation.sourceReferences],
  ];
}

function map(row: StorageOperationRow): ObjectStorageOperationRecord {
  return {
    operationId: row.operation_id,
    intent: {
      requestId: row.request_id,
      tenantId: row.tenant_id,
      requestedBySubjectId: row.requested_by_subject_id,
      operation: row.operation,
      purpose: row.purpose,
      objectReference: row.object_reference,
      sourceReference: row.source_reference,
      expectedSha256: row.expected_sha256,
      contentType: row.content_type,
      retentionPolicy: {
        key: row.retention_policy_key,
        version: row.retention_policy_version,
      },
      requiredResidencyTags: [...row.required_residency_tags],
      requiredComplianceTags: [...row.required_compliance_tags],
      deletionAuthorizationDecisionId:
        row.deletion_authorization_decision_id,
      idempotencyKey: row.idempotency_key,
      requestedAt: iso(row.requested_at),
      correlationId: row.correlation_id,
      evidenceRefs: [...row.evidence_refs],
    },
    observation: {
      requestId: row.request_id,
      tenantId: row.tenant_id,
      operation: row.operation,
      objectReference: row.object_reference,
      status: row.status,
      contentReference: row.content_reference,
      sha256: row.actual_sha256,
      connectorKey: row.connector_key,
      providerKey: row.provider_key,
      region: row.region,
      completedAt: iso(row.completed_at),
      sourceReferences: [...row.source_references],
    },
  };
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function iso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
