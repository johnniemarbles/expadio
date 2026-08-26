import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ObjectStorageOperationRecord,
} from '@expadio/storage';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import {
  PostgresObjectStorageOperationRepository,
} from '../src/storage-operation.ts';

class Client implements PostgresClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly steps: Array<SqlQueryResult | Error> = [];

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ) {
    this.calls.push({ text, values });
    const step = this.steps.shift() ?? { rows: [], rowCount: 0 };
    if (step instanceof Error) throw step;
    return step as SqlQueryResult<Row>;
  }
}

const digest =
  '0123456789abcdef0123456789abcdef'
  + '0123456789abcdef0123456789abcdef';

const record: ObjectStorageOperationRecord = {
  operationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  intent: {
    requestId: 'request-1',
    tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    requestedBySubjectId: 'subject-1',
    operation: 'STORE',
    purpose: 'Persist approved document.',
    objectReference: 'object://document-1',
    sourceReference: 'upload://document-1',
    expectedSha256: digest,
    contentType: 'application/pdf',
    retentionPolicy: { key: 'documents', version: 3 },
    requiredResidencyTags: ['ca'],
    requiredComplianceTags: ['regulated'],
    deletionAuthorizationDecisionId: null,
    idempotencyKey: 'store:document-1',
    requestedAt: '2026-08-26T00:00:00.000Z',
    correlationId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    evidenceRefs: ['approval://document-1'],
  },
  observation: {
    requestId: 'request-1',
    tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    operation: 'STORE',
    objectReference: 'object://document-1',
    status: 'STORED',
    contentReference: 'storage://document-1/v1',
    sha256: digest,
    connectorKey: 'tenant-storage',
    providerKey: 'customer-storage',
    region: 'ca-central-1',
    completedAt: '2026-08-26T00:00:01.000Z',
    sourceReferences: ['upload://document-1'],
  },
};

function row() {
  const { intent, observation } = record;
  return {
    operation_id: record.operationId,
    request_id: intent.requestId,
    tenant_id: intent.tenantId,
    requested_by_subject_id: intent.requestedBySubjectId,
    operation: intent.operation,
    purpose: intent.purpose,
    object_reference: intent.objectReference,
    source_reference: intent.sourceReference,
    expected_sha256: intent.expectedSha256,
    content_type: intent.contentType,
    retention_policy_key: intent.retentionPolicy.key,
    retention_policy_version: intent.retentionPolicy.version,
    required_residency_tags: intent.requiredResidencyTags,
    required_compliance_tags: intent.requiredComplianceTags,
    deletion_authorization_decision_id:
      intent.deletionAuthorizationDecisionId,
    idempotency_key: intent.idempotencyKey,
    requested_at: intent.requestedAt,
    status: observation.status,
    content_reference: observation.contentReference,
    actual_sha256: observation.sha256,
    connector_key: observation.connectorKey,
    provider_key: observation.providerKey,
    region: observation.region,
    completed_at: observation.completedAt,
    correlation_id: intent.correlationId,
    evidence_refs: intent.evidenceRefs,
    source_references: observation.sourceReferences,
  };
}

test('records a validated immutable storage operation', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 1 });

  const result =
    await new PostgresObjectStorageOperationRepository(client)
      .record(record);

  assert.equal(result.recorded, true);
  assert.match(
    client.calls[0]?.text ?? '',
    /INSERT INTO platform\.object_storage_operations/,
  );
  assert.equal(client.calls[0]?.values[20], 'tenant-storage');
  assert.deepEqual(client.calls[0]?.values[25], [
    'approval://document-1',
  ]);
});

test('loads exact tenant and request history', async () => {
  const client = new Client();
  client.steps.push({ rows: [row()], rowCount: 1 });

  const loaded =
    await new PostgresObjectStorageOperationRepository(client)
      .findByRequest({
        tenantId: record.intent.tenantId,
        requestId: record.intent.requestId,
      });

  assert.deepEqual(loaded, record);
  assert.match(client.calls[0]?.text ?? '', /tenant_id = \$1::uuid/);
  assert.deepEqual(client.calls[0]?.values, [
    record.intent.tenantId,
    record.intent.requestId,
  ]);
});

test('treats an exact retry as already recorded', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 });
  client.steps.push({ rows: [row()], rowCount: 1 });

  const result =
    await new PostgresObjectStorageOperationRepository(client)
      .record(record);

  assert.equal(result.recorded, false);
  assert.deepEqual(result.operation, record);
});

test('rejects an invalid observation before querying PostgreSQL', async () => {
  const client = new Client();

  await assert.rejects(
    () =>
      new PostgresObjectStorageOperationRepository(client).record({
        ...record,
        observation: {
          ...record.observation,
          tenantId: 'tenant-2',
        },
      }),
    /STORAGE_OPERATION_RECORD_INVALID/,
  );
  assert.equal(client.calls.length, 0);
});
