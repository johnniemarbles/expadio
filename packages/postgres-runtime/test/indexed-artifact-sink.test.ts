import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresIndexedDurableArtifactSink } from '../src/indexed-artifact-sink.ts';

const input = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  artifactKind: 'AI_TEXT' as const,
  sourceKind: 'AI_INVOCATION' as const,
  sourceId: 'inv_123',
  content: 'hello world',
  contentType: 'text/plain; charset=utf-8',
  providerKey: 'openai',
  connectorKey: 'connector.ai.openai.us',
  modelKey: 'gpt-4o-mini',
  requiredResidencyTags: ['US'],
  requiredComplianceTags: ['SOC2'],
};

test('PostgresIndexedDurableArtifactSink indexes the durable blob before success', async () => {
  const calls: string[] = [];
  const client = {
    query: async (sql: string, values?: readonly unknown[]) => {
      calls.push('index');
      assert.match(sql, /INSERT INTO platform\.execution_artifacts/);
      return {
        rows: [{
          artifact_id: '22222222-2222-4222-8222-222222222222',
          tenant_id: input.tenantId,
          artifact_kind: input.artifactKind,
          source_kind: input.sourceKind,
          source_id: input.sourceId,
          storage_reference: 'storage://ai/inv_123.txt',
          content_sha256: 'a'.repeat(64),
          media_type: input.contentType,
          byte_length: 11,
          provider_key: input.providerKey,
          connector_key: input.connectorKey,
          model_key: input.modelKey,
          correlation_id: null,
          created_at: new Date('2026-08-31T02:00:00.000Z'),
        }],
        rowCount: 1,
      };
    },
  };
  const delegate = {
    write: async () => {
      calls.push('blob');
      return {
        contentReference: 'storage://ai/inv_123.txt',
        sha256: 'a'.repeat(64),
        byteLength: 11,
      };
    },
  };

  const sink = new PostgresIndexedDurableArtifactSink(client, delegate);
  const result = await sink.write(input);

  assert.equal(result.contentReference, 'storage://ai/inv_123.txt');
  assert.deepEqual(calls, ['blob', 'index']);
});

test('PostgresIndexedDurableArtifactSink fails closed when indexing fails', async () => {
  const client = {
    query: async () => {
      throw new Error('INDEX_UNAVAILABLE');
    },
  };
  const delegate = {
    write: async () => ({
      contentReference: 'storage://ai/inv_123.txt',
      sha256: 'a'.repeat(64),
      byteLength: 11,
    }),
  };

  const sink = new PostgresIndexedDurableArtifactSink(client, delegate);
  await assert.rejects(sink.write(input), /INDEX_UNAVAILABLE/);
});
