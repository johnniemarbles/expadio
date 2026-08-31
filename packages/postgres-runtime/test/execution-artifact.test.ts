import assert from 'node:assert/strict';
import test from 'node:test';
import {
  persistExecutionArtifact,
  findExecutionArtifactBySource,
  type ExecutionArtifactSqlClient,
} from '../src/execution-artifact.ts';

const baseRow = {
  artifact_id: '11111111-1111-4111-8111-111111111111',
  tenant_id: '22222222-2222-4222-8222-222222222222',
  artifact_kind: 'AI_TEXT' as const,
  source_kind: 'AI_INVOCATION' as const,
  source_id: 'inv_123',
  storage_reference: 'storage://tenant/ai/inv_123/output.json',
  content_sha256: 'a'.repeat(64),
  media_type: 'application/json',
  byte_length: 128,
  provider_key: 'openai',
  connector_key: 'connector.ai.openai.us',
  model_key: 'gpt-4o-mini',
  correlation_id: 'corr_123',
  created_at: new Date('2026-08-31T02:00:00.000Z'),
};

const input = {
  tenantId: baseRow.tenant_id,
  artifactKind: baseRow.artifact_kind,
  sourceKind: baseRow.source_kind,
  sourceId: baseRow.source_id,
  storageReference: baseRow.storage_reference,
  contentSha256: baseRow.content_sha256,
  mediaType: baseRow.media_type,
  byteLength: baseRow.byte_length,
  providerKey: baseRow.provider_key,
  connectorKey: baseRow.connector_key,
  modelKey: baseRow.model_key,
  correlationId: baseRow.correlation_id,
};

test('persistExecutionArtifact commits a durable artifact reference', async () => {
  const client: ExecutionArtifactSqlClient = {
    query: async (sql) => {
      assert.match(sql, /INSERT INTO platform\.execution_artifacts/);
      return { rows: [baseRow], rowCount: 1 };
    },
  };

  const result = await persistExecutionArtifact(client, input);
  assert.equal(result.replayed, false);
  assert.equal(result.artifact.storageReference, input.storageReference);
  assert.equal(result.artifact.contentSha256, input.contentSha256);
  assert.equal(result.artifact.byteLength, 128);
});

test('persistExecutionArtifact treats an identical source replay as idempotent', async () => {
  let calls = 0;
  const client: ExecutionArtifactSqlClient = {
    query: async (sql) => {
      calls += 1;
      if (sql.includes('INSERT INTO')) return { rows: [], rowCount: 0 };
      assert.match(sql, /SELECT/);
      return { rows: [baseRow], rowCount: 1 };
    },
  };

  const result = await persistExecutionArtifact(client, input);
  assert.equal(result.replayed, true);
  assert.equal(calls, 2);
});

test('persistExecutionArtifact rejects a conflicting source replay', async () => {
  const client: ExecutionArtifactSqlClient = {
    query: async (sql) => {
      if (sql.includes('INSERT INTO')) return { rows: [], rowCount: 0 };
      return {
        rows: [{ ...baseRow, content_sha256: 'b'.repeat(64) }],
        rowCount: 1,
      };
    },
  };

  await assert.rejects(
    persistExecutionArtifact(client, input),
    /EXECUTION_ARTIFACT_REPLAY_CONFLICT/,
  );
});

test('persistExecutionArtifact validates hashes and byte lengths before SQL', async () => {
  const client: ExecutionArtifactSqlClient = {
    query: async () => assert.fail('SQL must not run for invalid artifact metadata'),
  };

  await assert.rejects(
    persistExecutionArtifact(client, { ...input, contentSha256: 'not-a-hash' }),
    /EXECUTION_ARTIFACT_SHA256_INVALID/,
  );

  await assert.rejects(
    persistExecutionArtifact(client, { ...input, byteLength: -1 }),
    /EXECUTION_ARTIFACT_BYTE_LENGTH_INVALID/,
  );
});

test('findExecutionArtifactBySource is tenant and source scoped', async () => {
  const client: ExecutionArtifactSqlClient = {
    query: async (sql, values) => {
      assert.match(sql, /tenant_id = \$1::uuid/);
      assert.deepEqual(values, [
        input.tenantId,
        input.artifactKind,
        input.sourceKind,
        input.sourceId,
      ]);
      return { rows: [baseRow], rowCount: 1 };
    },
  };

  const artifact = await findExecutionArtifactBySource(client, {
    tenantId: input.tenantId,
    artifactKind: input.artifactKind,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
  });

  assert.equal(artifact?.artifactId, baseRow.artifact_id);
});
