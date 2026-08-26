import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AuthorizedKnowledgeRetriever,
  KnowledgeRetrievalError,
  type KnowledgeRetrievalItem,
  type KnowledgeRetrievalQuery,
} from '../src/index.ts';

const query: KnowledgeRetrievalQuery = {
  queryId: 'query-1',
  tenantId: 'tenant-1',
  requesterSubjectId: 'subject-1',
  requesterAgentId: 'agent-1',
  purpose: 'Find approved policy evidence for a case.',
  queryReference: 'query://case/7/policy-search',
  collectionReferences: [
    'collection://tenant-1/policies',
  ],
  topK: 5,
  requestedAt: '2026-08-25T22:00:00.000Z',
  correlationId: 'correlation-1',
  evidenceRefs: ['case://7'],
};

const item: KnowledgeRetrievalItem = {
  tenantId: 'tenant-1',
  collectionReference: 'collection://tenant-1/policies',
  contentReference: 'content://document/2/chunk/4',
  metadataReference: 'metadata://document/2/v3',
  score: 0.92,
  citation: {
    documentReference: 'document://policy/2',
    documentVersion: 3,
    chunkReference: 'chunk-4',
  },
  indexedAt: '2026-08-20T10:00:00.000Z',
  retentionExpiresAt: '2027-08-20T10:00:00.000Z',
};

test('authorizes a filter before provider search and returns citations', async () => {
  const events: string[] = [];
  const retriever = new AuthorizedKnowledgeRetriever({
    authorization: {
      async authorize(input) {
        events.push('authorize:' + input.action);
        return {
          allowed: true,
          decisionId: 'decision-1',
          reasonKey: 'GRANTED',
          filterReference: 'acl-filter://decision-1',
        };
      },
    },
    provider: {
      async search(input) {
        events.push('search:' + input.authorizationFilterReference);
        return [item];
      },
    },
  });

  const result = await retriever.search(query);

  assert.deepEqual(events, [
    'authorize:knowledge.search',
    'search:acl-filter://decision-1',
  ]);
  assert.equal(result.authorizationDecisionId, 'decision-1');
  assert.deepEqual(result.sourceReferences, [
    'document://policy/2@3#chunk-4',
  ]);
  assert.equal('content' in result.items[0]!, false);
});

test('denial prevents provider search', async () => {
  let searched = false;
  const retriever = new AuthorizedKnowledgeRetriever({
    authorization: {
      async authorize() {
        return {
          allowed: false,
          decisionId: 'decision-2',
          reasonKey: 'ENTITLEMENT_REQUIRED',
          filterReference: null,
        };
      },
    },
    provider: {
      async search() {
        searched = true;
        return [];
      },
    },
  });

  await assert.rejects(
    () => retriever.search(query),
    (error: unknown) =>
      error instanceof KnowledgeRetrievalError
      && error.code === 'KNOWLEDGE_ACCESS_DENIED'
      && error.reasonKey === 'ENTITLEMENT_REQUIRED',
  );
  assert.equal(searched, false);
});

test('rejects cross-tenant or unauthorized collection results', async () => {
  const retriever = new AuthorizedKnowledgeRetriever({
    authorization: {
      async authorize() {
        return {
          allowed: true,
          decisionId: 'decision-3',
          reasonKey: 'GRANTED',
          filterReference: 'acl-filter://decision-3',
        };
      },
    },
    provider: {
      async search() {
        return [{ ...item, tenantId: 'tenant-2' }];
      },
    },
  });

  await assert.rejects(
    () => retriever.search(query),
    (error: unknown) =>
      error instanceof KnowledgeRetrievalError
      && error.code === 'KNOWLEDGE_RESULT_IDENTITY_MISMATCH',
  );
});

test('rejects uncited or duplicate knowledge chunks', async () => {
  const authorization = {
    async authorize() {
      return {
        allowed: true,
        decisionId: 'decision-4',
        reasonKey: 'GRANTED',
        filterReference: 'acl-filter://decision-4',
      };
    },
  };
  await assert.rejects(
    () =>
      new AuthorizedKnowledgeRetriever({
        authorization,
        provider: {
          async search() {
            return [
              item,
              item,
            ];
          },
        },
      }).search(query),
    (error: unknown) =>
      error instanceof KnowledgeRetrievalError
      && error.code === 'KNOWLEDGE_RESULT_DUPLICATE',
  );

  await assert.rejects(
    () =>
      new AuthorizedKnowledgeRetriever({
        authorization,
        provider: {
          async search() {
            return [{
              ...item,
              citation: {
                ...item.citation,
                chunkReference: ' ',
              },
            }];
          },
        },
      }).search(query),
    (error: unknown) =>
      error instanceof KnowledgeRetrievalError
      && error.code === 'KNOWLEDGE_RESULT_INVALID',
  );
});

test('rejects retention-expired knowledge', async () => {
  const retriever = new AuthorizedKnowledgeRetriever({
    authorization: {
      async authorize() {
        return {
          allowed: true,
          decisionId: 'decision-5',
          reasonKey: 'GRANTED',
          filterReference: 'acl-filter://decision-5',
        };
      },
    },
    provider: {
      async search() {
        return [{
          ...item,
          retentionExpiresAt: '2026-08-25T21:59:59.000Z',
        }];
      },
    },
  });

  await assert.rejects(
    () => retriever.search(query),
    (error: unknown) =>
      error instanceof KnowledgeRetrievalError
      && error.code === 'KNOWLEDGE_RESULT_EXPIRED',
  );
});
