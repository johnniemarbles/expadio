import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DENTEX_PACK,
  resolveIndustryPackRuntime,
  type IndustryPackVersion,
  type PublishedIndustryPackReader,
} from '../src/index.ts';

class Reader implements PublishedIndustryPackReader {
  readonly value: IndustryPackVersion | null;

  constructor(value: IndustryPackVersion | null) {
    this.value = value;
  }

  async findPublished(): Promise<IndustryPackVersion | null> {
    return this.value;
  }
}

const authored: IndustryPackVersion = {
  identity: { verticalKey: 'dentex', version: 3 },
  scope: { type: 'TENANT', tenantId: '11111111-1111-1111-1111-111111111111' },
  source: 'TENANT_AUTHORED',
  state: 'PUBLISHED',
  definition: { ...DENTEX_PACK, label: 'Tenant DENTEX' },
  revision: 5,
  createdBySubjectId: 'author',
  createdAt: '2026-08-29T18:00:00.000Z',
  updatedBySubjectId: 'publisher',
  updatedAt: '2026-08-29T20:00:00.000Z',
  publishedBySubjectId: 'publisher',
  publishedAt: '2026-08-29T20:00:00.000Z',
};

test('published authored pack wins over code baseline and returns an exact runtime pin', async () => {
  const result = await resolveIndustryPackRuntime({
    tenantId: authored.scope.type === 'TENANT' ? authored.scope.tenantId : '',
    verticalKey: ' DENTEX ',
    publishedReader: new Reader(authored),
  });

  assert.equal(result.source, 'TENANT_AUTHORED');
  assert.equal(result.pack?.label, 'Tenant DENTEX');
  assert.deepEqual(result.pin, {
    verticalKey: 'dentex',
    version: 3,
    scope: authored.scope,
  });
});

test('code baseline remains the migration fallback when no authored version is published', async () => {
  const result = await resolveIndustryPackRuntime({
    tenantId: '11111111-1111-1111-1111-111111111111',
    verticalKey: 'dentex',
    publishedReader: new Reader(null),
  });

  assert.equal(result.source, 'CODE_BASELINE');
  assert.equal(result.pack, DENTEX_PACK);
  assert.equal(result.pin, undefined);
});

test('unknown or unbound vertical resolves to the neutral engine', async () => {
  const unknown = await resolveIndustryPackRuntime({
    tenantId: '11111111-1111-1111-1111-111111111111',
    verticalKey: 'unknown',
    publishedReader: new Reader(null),
  });
  const unbound = await resolveIndustryPackRuntime({
    tenantId: '11111111-1111-1111-1111-111111111111',
    verticalKey: null,
    publishedReader: new Reader(null),
  });

  assert.deepEqual(unknown, { pack: null, source: 'NONE' });
  assert.deepEqual(unbound, { pack: null, source: 'NONE' });
});

test('reader returning a non-published artifact fails closed', async () => {
  await assert.rejects(
    resolveIndustryPackRuntime({
      tenantId: '11111111-1111-1111-1111-111111111111',
      verticalKey: 'dentex',
      publishedReader: new Reader({ ...authored, state: 'DRAFT' }),
    }),
    /INDUSTRY_PACK_RUNTIME_READER_RETURNED_NON_PUBLISHED/,
  );
});
