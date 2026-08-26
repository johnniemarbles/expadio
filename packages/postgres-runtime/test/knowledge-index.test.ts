import assert from 'node:assert/strict';
import test from 'node:test';
import type { KnowledgeIndexManifest } from '@expadio/knowledge';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import {
  PostgresKnowledgeIndexManifestRepository,
} from '../src/knowledge-index.ts';

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

const manifest: KnowledgeIndexManifest = {
  request: {
    ingestionId: 'ingestion-1',
    tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    requestedBySubjectId: 'subject-1',
    purpose: 'Index an approved policy version.',
    collectionReference: 'collection://policies',
    documentReference: 'document://policy/2',
    documentVersion: 3,
    sourceReference: 'object://policy/2/v3',
    sourceDigest: digest,
    metadataReference: 'metadata://policy/2/v3',
    chunks: [{
      ordinal: 0,
      chunkReference: 'chunk-0',
      contentReference: 'content://policy/2/v3/chunk-0',
      contentDigest: digest,
    }],
    embeddingConfiguration: { key: 'embedding', version: 2 },
    accessPolicy: { key: 'access', version: 4 },
    retentionPolicy: { key: 'retention', version: 1 },
    retentionExpiresAt: '2027-08-25T22:00:00.000Z',
    requestedAt: '2026-08-25T21:59:00.000Z',
    correlationId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    evidenceRefs: ['approval://policy/2/v3'],
  },
  authorizationDecisionId: 'authorization-1',
  indexReference: 'index://policy/2/v3',
  indexedAt: '2026-08-25T22:00:01.000Z',
  reason: 'Approved indexing request completed.',
};

function documentRow(indexReference = manifest.indexReference) {
  return {
    tenant_id: manifest.request.tenantId,
    ingestion_id: manifest.request.ingestionId,
    purpose: manifest.request.purpose,
    requested_at: manifest.request.requestedAt,
    collection_reference: manifest.request.collectionReference,
    document_reference: manifest.request.documentReference,
    document_version: manifest.request.documentVersion,
    source_reference: manifest.request.sourceReference,
    source_digest: manifest.request.sourceDigest,
    metadata_reference: manifest.request.metadataReference,
    embedding_configuration_key:
      manifest.request.embeddingConfiguration.key,
    embedding_configuration_version:
      manifest.request.embeddingConfiguration.version,
    access_policy_key: manifest.request.accessPolicy.key,
    access_policy_version: manifest.request.accessPolicy.version,
    retention_policy_key: manifest.request.retentionPolicy.key,
    retention_policy_version: manifest.request.retentionPolicy.version,
    retention_expires_at: manifest.request.retentionExpiresAt,
    authorization_decision_id: manifest.authorizationDecisionId,
    index_reference: indexReference,
    indexed_at: manifest.indexedAt,
    indexed_by_subject_id: manifest.request.requestedBySubjectId,
    reason: manifest.reason,
    correlation_id: manifest.request.correlationId,
    evidence_refs: manifest.request.evidenceRefs,
  };
}

const chunkRow = {
  ordinal: 0,
  chunk_reference: 'chunk-0',
  content_reference: 'content://policy/2/v3/chunk-0',
  content_digest: digest,
};

test('commits a document and chunks through a transaction-bound client', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 1 });
  client.steps.push({ rows: [], rowCount: 1 });

  const result =
    await new PostgresKnowledgeIndexManifestRepository(client)
      .commit(manifest);

  assert.equal(result.status, 'COMMITTED');
  assert.match(client.calls[0]?.text ?? '', /knowledge_documents/);
  assert.match(client.calls[1]?.text ?? '', /knowledge_chunks/);
  assert.equal(client.calls[0]?.values[1], 'ingestion-1');
  assert.equal(client.calls[0]?.values[17], 'authorization-1');
  assert.equal(client.calls[0]?.values[18], manifest.indexReference);
});

test('loads distinct request and indexing audit fields exactly', async () => {
  const client = new Client();
  client.steps.push({ rows: [documentRow()], rowCount: 1 });
  client.steps.push({ rows: [chunkRow], rowCount: 1 });

  const loaded =
    await new PostgresKnowledgeIndexManifestRepository(client).load({
      tenantId: manifest.request.tenantId,
      documentReference: manifest.request.documentReference,
      documentVersion: 3,
    });

  assert.deepEqual(loaded, manifest);
  assert.match(client.calls[0]?.text ?? '', /tenant_id = \$1::uuid/);
  assert.match(client.calls[1]?.text ?? '', /ORDER BY ordinal ASC/);
});

test('returns a conflict for different immutable provenance', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 });
  client.steps.push({
    rows: [documentRow('index://different')],
    rowCount: 1,
  });
  client.steps.push({ rows: [chunkRow], rowCount: 1 });

  const result =
    await new PostgresKnowledgeIndexManifestRepository(client)
      .commit(manifest);

  assert.equal(result.status, 'VERSION_CONFLICT');
});
