import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DENTEX_PACK,
  type IndustryPackRuntimeResolution,
  type PublishedIndustryPackSnapshot,
} from '../src/index.ts';

test('runtime pack snapshot carries exact scope/version/revision provenance', () => {
  const snapshot: PublishedIndustryPackSnapshot = {
    identity: { verticalKey: 'dentex', version: 3 },
    scope: { type: 'TENANT', tenantId: '11111111-1111-1111-1111-111111111111' },
    source: 'TENANT_AUTHORED',
    revision: 5,
    definition: DENTEX_PACK,
    publishedAt: '2026-08-30T00:00:00.000Z',
    publishedBySubjectId: 'subject-publisher',
  };

  const resolution: IndustryPackRuntimeResolution = {
    snapshot,
    reason: 'TENANT_PUBLISHED_OVERRIDE',
    precedenceTrace: ['tenant-published'],
  };

  assert.equal(resolution.snapshot.identity.version, 3);
  assert.equal(resolution.snapshot.revision, 5);
  assert.equal(resolution.snapshot.scope.type, 'TENANT');
  assert.equal(resolution.snapshot.definition.verticalKey, 'dentex');
});

test('runtime resolution reasons make persisted precedence explicit', () => {
  const reasons: IndustryPackRuntimeResolution['reason'][] = [
    'EXPLICIT_PIN',
    'TENANT_PUBLISHED_OVERRIDE',
    'PLATFORM_PUBLISHED_DEFAULT',
  ];
  assert.deepEqual(reasons, [
    'EXPLICIT_PIN',
    'TENANT_PUBLISHED_OVERRIDE',
    'PLATFORM_PUBLISHED_DEFAULT',
  ]);
});
