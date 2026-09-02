import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACME_CORP_PACK,
  canTransitionIndustryPackVersion,
  transitionIndustryPackVersion,
  type IndustryPackVersion,
} from '../src/index.ts';

const draft: IndustryPackVersion = {
  identity: { verticalKey: 'acme-corp', version: 2 },
  scope: { type: 'TENANT', tenantId: '11111111-1111-1111-1111-111111111111' },
  source: 'TENANT_AUTHORED',
  state: 'DRAFT',
  definition: ACME_CORP_PACK,
  revision: 3,
  createdBySubjectId: 'author',
  createdAt: '2026-08-29T18:00:00.000Z',
  updatedBySubjectId: 'author',
  updatedAt: '2026-08-29T18:00:00.000Z',
};

test('lifecycle allows review/publish/supersede/archive progression and controlled return', () => {
  assert.equal(canTransitionIndustryPackVersion('DRAFT', 'IN_REVIEW'), true);
  assert.equal(canTransitionIndustryPackVersion('IN_REVIEW', 'DRAFT'), true);
  assert.equal(canTransitionIndustryPackVersion('IN_REVIEW', 'PUBLISHED'), true);
  assert.equal(canTransitionIndustryPackVersion('PUBLISHED', 'SUPERSEDED'), true);
  assert.equal(canTransitionIndustryPackVersion('SUPERSEDED', 'ARCHIVED'), true);
  assert.equal(canTransitionIndustryPackVersion('ARCHIVED', 'DRAFT'), false);
});

test('submission stamps review provenance without changing definition or revision', () => {
  const submitted = transitionIndustryPackVersion({
    current: draft,
    to: 'IN_REVIEW',
    actorSubjectId: 'review-submitter',
    occurredAt: '2026-08-29T19:00:00.000Z',
  });

  assert.equal(submitted.state, 'IN_REVIEW');
  assert.equal(submitted.revision, 3);
  assert.equal(submitted.definition, draft.definition);
  assert.equal(submitted.submittedBySubjectId, 'review-submitter');
  assert.equal(submitted.submittedAt, '2026-08-29T19:00:00.000Z');
});

test('publication stamps publication provenance and preserves earlier submission evidence', () => {
  const submitted = transitionIndustryPackVersion({
    current: draft,
    to: 'IN_REVIEW',
    actorSubjectId: 'submitter',
    occurredAt: '2026-08-29T19:00:00.000Z',
  });
  const published = transitionIndustryPackVersion({
    current: submitted,
    to: 'PUBLISHED',
    actorSubjectId: 'publisher',
    occurredAt: '2026-08-29T20:00:00.000Z',
  });

  assert.equal(published.publishedBySubjectId, 'publisher');
  assert.equal(published.publishedAt, '2026-08-29T20:00:00.000Z');
  assert.equal(published.submittedBySubjectId, 'submitter');
  assert.equal(published.revision, 3);
});

test('invalid lifecycle transitions fail closed', () => {
  assert.throws(
    () => transitionIndustryPackVersion({
      current: draft,
      to: 'PUBLISHED',
      actorSubjectId: 'publisher',
      occurredAt: '2026-08-29T20:00:00.000Z',
    }),
    /cannot transition from DRAFT to PUBLISHED/,
  );
});
