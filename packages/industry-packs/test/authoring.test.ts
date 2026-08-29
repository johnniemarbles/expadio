import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DENTEX_PACK,
  type IndustryPackVersion,
  type PinnedIndustryPackVersion,
} from '../src/index.ts';

test('an authored pack version carries scope, lifecycle, provenance and draft revision separately', () => {
  const record: IndustryPackVersion = {
    identity: { verticalKey: 'dentex', version: 2 },
    scope: { type: 'TENANT', tenantId: '11111111-1111-1111-1111-111111111111' },
    source: 'TENANT_AUTHORED',
    state: 'DRAFT',
    definition: DENTEX_PACK,
    revision: 4,
    parent: { verticalKey: 'dentex', version: 1 },
    createdBySubjectId: 'subject-author',
    createdAt: '2026-08-29T18:00:00.000Z',
    updatedBySubjectId: 'subject-editor',
    updatedAt: '2026-08-29T18:30:00.000Z',
  };

  assert.equal(record.identity.version, 2);
  assert.equal(record.revision, 4);
  assert.equal(record.state, 'DRAFT');
  assert.equal(record.scope.type, 'TENANT');
  if (record.scope.type === 'TENANT') {
    assert.equal(record.scope.tenantId, '11111111-1111-1111-1111-111111111111');
  }
});

test('a runtime pin includes authoring scope to prevent platform/tenant version ambiguity', () => {
  const pin: PinnedIndustryPackVersion = {
    verticalKey: 'dentex',
    version: 1,
    scope: { type: 'PLATFORM' },
  };

  assert.equal(pin.scope.type, 'PLATFORM');
  assert.equal(pin.verticalKey, 'dentex');
  assert.equal(pin.version, 1);
});
