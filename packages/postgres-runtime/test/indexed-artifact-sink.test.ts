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
          content_sha256: 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
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
        sha256: 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
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
      sha256: 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
      byteLength: 11,
    }),
  };

  const sink = new PostgresIndexedDurableArtifactSink(client, delegate);
  await assert.rejects(sink.write(input), /INDEX_UNAVAILABLE/);
});


test('PostgresIndexedDurableArtifactSink rejects a storage digest that does not match the bytes', async () => {
  const client = {
    query: async () => assert.fail('index must not run for an invalid digest'),
  };
  const delegate = {
    write: async () => ({
      contentReference: 'storage://ai/inv_123.txt',
      sha256: '0'.repeat(64),
      byteLength: 11,
    }),
  };

  const sink = new PostgresIndexedDurableArtifactSink(client, delegate);
  await assert.rejects(
    sink.write(input),
    /EXECUTION_ARTIFACT_STORAGE_DIGEST_MISMATCH/,
  );
});

test('PostgresIndexedDurableArtifactSink rejects a storage byte length that does not match the bytes', async () => {
  const client = {
    query: async () => assert.fail('index must not run for an invalid byte length'),
  };
  const delegate = {
    write: async () => ({
      contentReference: 'storage://ai/inv_123.txt',
      sha256: 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
      byteLength: 99,
    }),
  };

  const sink = new PostgresIndexedDurableArtifactSink(client, delegate);
  await assert.rejects(
    sink.write(input),
    /EXECUTION_ARTIFACT_STORAGE_BYTE_LENGTH_MISMATCH/,
  );
});

test('PostgresIndexedDurableArtifactSink measures UTF-8 bytes rather than string characters', async () => {
  const unicodeInput = { ...input, sourceId: 'inv_unicode', content: 'é' };
  const client = {
    query: async (sql: string) => ({
      rows: [{
        artifact_id: '33333333-3333-4333-8333-333333333333',
        tenant_id: unicodeInput.tenantId,
        artifact_kind: unicodeInput.artifactKind,
        source_kind: unicodeInput.sourceKind,
        source_id: unicodeInput.sourceId,
        storage_reference: 'storage://ai/inv_unicode.txt',
        content_sha256: '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c',
        media_type: unicodeInput.contentType,
        byte_length: 2,
        provider_key: unicodeInput.providerKey,
        connector_key: unicodeInput.connectorKey,
        model_key: unicodeInput.modelKey,
        correlation_id: null,
        created_at: new Date('2026-08-31T02:00:00.000Z'),
      }],
      rowCount: 1,
    }),
  };
  const delegate = {
    write: async () => ({
      contentReference: 'storage://ai/inv_unicode.txt',
      sha256: '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c',
      byteLength: 2,
    }),
  };

  const sink = new PostgresIndexedDurableArtifactSink(client, delegate);
  const result = await sink.write(unicodeInput);
  assert.equal(result.byteLength, 2);
});
