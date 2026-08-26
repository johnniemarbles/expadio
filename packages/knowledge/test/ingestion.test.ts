import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GovernedKnowledgeIndexer,
  KnowledgeIndexError,
  type KnowledgeIndexRequest,
} from '../src/index.ts';

const digest =
  '0123456789abcdef0123456789abcdef'
  + '0123456789abcdef0123456789abcdef';

const request: KnowledgeIndexRequest = {
  ingestionId: 'ingestion-1',
  tenantId: 'tenant-1',
  requestedBySubjectId: 'subject-1',
  purpose: 'Index an approved policy version.',
  collectionReference: 'collection://tenant-1/policies',
  documentReference: 'document://policy/2',
  documentVersion: 3,
  sourceReference: 'object://tenant-1/policy-2-v3',
  sourceDigest: digest,
  metadataReference: 'metadata://policy/2/v3',
  chunks: [
    {
      ordinal: 0,
      chunkReference: 'chunk-1',
      contentReference: 'content://policy/2/v3/chunk-1',
      contentDigest: digest,
    },
    {
      ordinal: 1,
      chunkReference: 'chunk-2',
      contentReference: 'content://policy/2/v3/chunk-2',
      contentDigest: digest,
    },
  ],
  embeddingConfiguration: {
    key: 'knowledge-embedding',
    version: 2,
  },
  accessPolicy: {
    key: 'policy-access',
    version: 4,
  },
  retentionPolicy: {
    key: 'policy-retention',
    version: 1,
  },
  retentionExpiresAt: '2027-08-25T22:00:00.000Z',
  requestedAt: '2026-08-25T22:00:00.000Z',
  correlationId: 'correlation-1',
  evidenceRefs: ['approval://document/2/v3'],
};

function observation() {
  return {
    ingestionId: request.ingestionId,
    tenantId: request.tenantId,
    collectionReference: request.collectionReference,
    documentReference: request.documentReference,
    documentVersion: request.documentVersion,
    indexReference: 'index://policy/2/v3',
    chunkReferences: ['chunk-1', 'chunk-2'],
    sourceReferences: [request.sourceReference],
    indexedAt: '2026-08-25T22:00:01.000Z',
  };
}

test('authorizes before indexing versioned reference-only chunks', async () => {
  const events: string[] = [];
  const indexer = new GovernedKnowledgeIndexer({
    authorization: {
      async authorize(input) {
        events.push('authorize:' + input.action);
        return {
          allowed: true,
          decisionId: 'decision-1',
          reasonKey: 'GRANTED',
        };
      },
    },
    provider: {
      async index(input) {
        events.push(
          'index:' + input.authorizationDecisionId,
        );
        assert.equal('content' in input.chunks[0]!, false);
        return observation();
      },
    },
  });

  const receipt = await indexer.index(request);

  assert.deepEqual(events, [
    'authorize:knowledge.index',
    'index:decision-1',
  ]);
  assert.equal(receipt.authorizationDecisionId, 'decision-1');
  assert.deepEqual(
    receipt.observation.chunkReferences,
    ['chunk-1', 'chunk-2'],
  );
});

test('denial prevents provider indexing', async () => {
  let indexed = false;
  const indexer = new GovernedKnowledgeIndexer({
    authorization: {
      async authorize() {
        return {
          allowed: false,
          decisionId: 'decision-2',
          reasonKey: 'SCOPE_MISMATCH',
        };
      },
    },
    provider: {
      async index() {
        indexed = true;
        return observation();
      },
    },
  });

  await assert.rejects(
    () => indexer.index(request),
    (error: unknown) =>
      error instanceof KnowledgeIndexError
      && error.code === 'KNOWLEDGE_INDEX_ACCESS_DENIED'
      && error.reasonKey === 'SCOPE_MISMATCH',
  );
  assert.equal(indexed, false);
});

test('rejects non-contiguous or duplicate chunk manifests', async () => {
  const indexer = new GovernedKnowledgeIndexer({
    authorization: {
      async authorize() {
        throw new Error('unreachable');
      },
    },
    provider: {
      async index() {
        throw new Error('unreachable');
      },
    },
  });

  await assert.rejects(
    () =>
      indexer.index({
        ...request,
        chunks: [
          request.chunks[0]!,
          { ...request.chunks[1]!, ordinal: 2 },
        ],
      }),
    (error: unknown) =>
      error instanceof KnowledgeIndexError
      && error.code === 'KNOWLEDGE_INDEX_CHUNK_SEQUENCE_INVALID',
  );

  await assert.rejects(
    () =>
      indexer.index({
        ...request,
        chunks: [
          request.chunks[0]!,
          {
            ...request.chunks[1]!,
            chunkReference: 'chunk-1',
          },
        ],
      }),
    (error: unknown) =>
      error instanceof KnowledgeIndexError
      && error.code === 'KNOWLEDGE_INDEX_CHUNK_DUPLICATE',
  );
});

test('rejects cross-tenant provider observations', async () => {
  const indexer = new GovernedKnowledgeIndexer({
    authorization: {
      async authorize() {
        return {
          allowed: true,
          decisionId: 'decision-3',
          reasonKey: 'GRANTED',
        };
      },
    },
    provider: {
      async index() {
        return { ...observation(), tenantId: 'tenant-2' };
      },
    },
  });

  await assert.rejects(
    () => indexer.index(request),
    (error: unknown) =>
      error instanceof KnowledgeIndexError
      && error.code
        === 'KNOWLEDGE_INDEX_OBSERVATION_IDENTITY_MISMATCH',
  );
});

test('requires the provider to confirm every ordered chunk', async () => {
  const indexer = new GovernedKnowledgeIndexer({
    authorization: {
      async authorize() {
        return {
          allowed: true,
          decisionId: 'decision-4',
          reasonKey: 'GRANTED',
        };
      },
    },
    provider: {
      async index() {
        return {
          ...observation(),
          chunkReferences: ['chunk-2', 'chunk-1'],
        };
      },
    },
  });

  await assert.rejects(
    () => indexer.index(request),
    (error: unknown) =>
      error instanceof KnowledgeIndexError
      && error.code === 'KNOWLEDGE_INDEX_OBSERVATION_INVALID',
  );
});
