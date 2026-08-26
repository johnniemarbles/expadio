import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusinessConfigurationPublication } from '@expadio/business-config';
import {
  CorrectionPublicationIndexError,
  prepareCorrectionPublicationIndexRequests,
} from '../src/index.ts';

const publication: BusinessConfigurationPublication = {
  changesetId: 'changeset-1', scope: { kind: 'TENANT', tenantId: 'tenant-1' },
  baseRevision: 4, revision: 5,
  objects: [{
    kind: 'COMPANY_FACT', key: 'company-profile', version: 5,
    scope: { kind: 'TENANT', tenantId: 'tenant-1' }, label: 'Company profile',
    state: 'PUBLISHED', dependencies: [], authoredBySubjectId: 'reviewer-1',
    authoredAt: '2026-08-26T00:05:00.000Z',
    payload: {
      correctionProposalReference: 'correction://proposal/1',
      proposedCorrectionReference: 'correction-delta://1',
      proposedCorrectionDigest: `sha256:${'a'.repeat(64)}`,
    },
  }],
  publishedBySubjectId: 'publisher-1', publishedAt: '2026-08-26T00:10:00.000Z',
  reason: 'Approved correction.', evidenceRefs: ['approval://1'],
};
const input = {
  ingestionIdPrefix: 'brain-correction',
  collectionReference: 'collection://tenant-1/company-brain',
  metadataReferencePrefix: 'metadata://tenant-1/company-brain',
  embeddingConfiguration: { key: 'embedding', version: 1 },
  accessPolicy: { key: 'brain-access', version: 2 },
  retentionPolicy: { key: 'brain-retention', version: 1 },
  retentionExpiresAt: null,
  requestedAt: '2026-08-26T00:10:01.000Z', correlationId: 'correlation-1',
};

test('prepares versioned reference-only indexing after publication', () => {
  const requests = prepareCorrectionPublicationIndexRequests(publication, input);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.documentVersion, 5);
  assert.equal(requests[0]?.sourceReference, 'correction-delta://1');
  assert.equal(requests[0]?.sourceDigest, 'a'.repeat(64));
  assert.equal('content' in (requests[0]?.chunks[0] ?? {}), false);
  assert.equal(requests[0]?.evidenceRefs.includes('correction://proposal/1'), true);
});

test('rejects non-tenant publication', () => {
  assert.throws(
    () => prepareCorrectionPublicationIndexRequests({
      ...publication, scope: { kind: 'PLATFORM' },
    }, input),
    (error) => error instanceof CorrectionPublicationIndexError
      && error.code === 'CORRECTION_PUBLICATION_SCOPE_INVALID',
  );
});

test('rejects publication without correction digest provenance', () => {
  assert.throws(
    () => prepareCorrectionPublicationIndexRequests({
      ...publication,
      objects: [{ ...publication.objects[0]!, payload: { rawContent: 'secret' } }],
    }, input),
    (error) => error instanceof CorrectionPublicationIndexError
      && error.code === 'CORRECTION_PUBLICATION_PAYLOAD_INVALID',
  );
});
