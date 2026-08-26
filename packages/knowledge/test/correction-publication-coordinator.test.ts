import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  BusinessConfigurationPublication,
  BusinessConfigurationPublishRequest,
  BusinessConfigurationPublishResult,
} from '@expadio/business-config';
import {
  CorrectionPublicationCoordinator,
  type AuthorizedKnowledgeIndexReceipt,
} from '../src/index.ts';

const publication: BusinessConfigurationPublication = {
  changesetId: 'changeset-1', scope: { kind: 'TENANT', tenantId: 'tenant-1' },
  baseRevision: 0, revision: 1,
  objects: [{
    kind: 'COMPANY_FACT', key: 'fact-1', version: 1,
    scope: { kind: 'TENANT', tenantId: 'tenant-1' }, label: 'Corrected fact',
    state: 'PUBLISHED', dependencies: [], authoredBySubjectId: 'reviewer-1',
    authoredAt: '2026-08-26T00:00:00.000Z',
    payload: {
      correctionProposalReference: 'correction://1',
      proposedCorrectionReference: 'delta://1',
      proposedCorrectionDigest: `sha256:${'a'.repeat(64)}`,
    },
  }],
  publishedBySubjectId: 'publisher-1', publishedAt: '2026-08-26T00:01:00.000Z',
  reason: 'Approved correction', evidenceRefs: ['approval://1'],
};
const publishRequest = {
  changeset: {} as BusinessConfigurationPublishRequest['changeset'],
  publishedBySubjectId: 'publisher-1', publishedAt: publication.publishedAt,
};
const indexInput = {
  ingestionIdPrefix: 'correction', collectionReference: 'collection://brain',
  metadataReferencePrefix: 'metadata://brain',
  embeddingConfiguration: { key: 'embedding', version: 1 },
  accessPolicy: { key: 'access', version: 1 },
  retentionPolicy: { key: 'retention', version: 1 },
  retentionExpiresAt: null, requestedAt: '2026-08-26T00:01:01.000Z',
  correlationId: 'correlation-1',
};
const receipt = (ingestionId: string): AuthorizedKnowledgeIndexReceipt => ({
  authorizationDecisionId: 'authorization-1', correlationId: 'correlation-1',
  evidenceRefs: ['approval://1'],
  observation: {
    ingestionId, tenantId: 'tenant-1', collectionReference: 'collection://brain',
    documentReference: 'business-config://COMPANY_FACT/fact-1', documentVersion: 1,
    indexReference: 'index://1', chunkReferences: ['configuration://COMPANY_FACT:fact-1@1'],
    sourceReferences: ['delta://1'], indexedAt: '2026-08-26T00:01:02.000Z',
  },
});

test('publishes before indexing and returns complete receipts', async () => {
  const events: string[] = [];
  const coordinator = new CorrectionPublicationCoordinator({
    publisher: { async publish() { events.push('publish'); return { status: 'PUBLISHED', publication }; } },
    indexer: { async index(request) { events.push('index'); return receipt(request.ingestionId); } },
  });
  const result = await coordinator.publishAndIndex(publishRequest, indexInput);
  assert.deepEqual(events, ['publish', 'index']);
  assert.equal(result.status, 'PUBLISHED_AND_INDEXED');
});

test('resumes indexing after an already-published retry', async () => {
  const coordinator = new CorrectionPublicationCoordinator({
    publisher: { async publish() { return { status: 'ALREADY_PUBLISHED', publication }; } },
    indexer: { async index(request) { return receipt(request.ingestionId); } },
  });
  const result = await coordinator.publishAndIndex(publishRequest, indexInput);
  assert.equal(result.status, 'ALREADY_PUBLISHED_AND_INDEXED');
});

test('does not index denied or conflicting publication', async () => {
  for (const outcome of [
    { status: 'DENIED', code: 'POLICY_DENIED', reason: 'Denied', evidenceRefs: ['policy://1'] },
    { status: 'CONFLICT', currentRevision: 3 },
  ] as const satisfies readonly BusinessConfigurationPublishResult[]) {
    let indexed = false;
    const coordinator = new CorrectionPublicationCoordinator({
      publisher: { async publish() { return outcome; } },
      indexer: { async index() { indexed = true; throw new Error('unreachable'); } },
    });
    const result = await coordinator.publishAndIndex(publishRequest, indexInput);
    assert.equal(result.status, outcome.status);
    assert.equal(indexed, false);
  }
});
