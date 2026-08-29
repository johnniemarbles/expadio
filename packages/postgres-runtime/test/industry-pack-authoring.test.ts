import assert from 'node:assert/strict';
import test from 'node:test';
import { DENTEX_PACK } from '@expadio/industry-packs';
import { PostgresIndustryPackVersionRepository } from '../src/industry-pack-authoring.ts';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';

class ScriptedClient implements PostgresClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly responses: SqlQueryResult[] = [];

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    return (this.responses.shift() ?? { rows: [], rowCount: 0 }) as SqlQueryResult<Row>;
  }
}

const row = {
  tenant_id: '11111111-1111-1111-1111-111111111111',
  vertical_key: 'dentex',
  version: 2,
  source: 'TENANT_AUTHORED',
  state: 'DRAFT',
  revision: 1,
  definition: DENTEX_PACK,
  parent_vertical_key: 'dentex',
  parent_version: 1,
  created_by_subject_id: 'author',
  created_at: '2026-08-29T18:00:00.000Z',
  updated_by_subject_id: 'author',
  updated_at: '2026-08-29T18:00:00.000Z',
  submitted_by_subject_id: null,
  submitted_at: null,
  published_by_subject_id: null,
  published_at: null,
};

test('createDraft allocates the next scoped version and maps the persisted artifact', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [row], rowCount: 1 });

  const result = await new PostgresIndustryPackVersionRepository(client).createDraft({
    scope: { type: 'TENANT', tenantId: row.tenant_id },
    verticalKey: ' DENTEX ',
    definition: DENTEX_PACK,
    createdBySubjectId: 'author',
    parent: { verticalKey: 'dentex', version: 1 },
  });

  assert.equal(result.identity.version, 2);
  assert.equal(result.scope.type, 'TENANT');
  assert.equal(result.revision, 1);
  assert.match(client.calls[0]?.text ?? '', /COALESCE\(MAX\(version\), 0\) \+ 1/);
  assert.deepEqual(client.calls[0]?.values.slice(0, 3), [
    row.tenant_id,
    'dentex',
    'TENANT_AUTHORED',
  ]);
});

test('updateDraft uses revision as an optimistic concurrency predicate', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [{ ...row, revision: 2 }], rowCount: 1 });

  const result = await new PostgresIndustryPackVersionRepository(client).updateDraft({
    scope: { type: 'TENANT', tenantId: row.tenant_id },
    identity: { verticalKey: 'dentex', version: 2 },
    expectedRevision: 1,
    definition: DENTEX_PACK,
    updatedBySubjectId: 'editor',
  });

  assert.equal(result.revision, 2);
  assert.match(client.calls[0]?.text ?? '', /revision = revision \+ 1/);
  assert.match(client.calls[0]?.text ?? '', /AND revision = \$6/);
  assert.equal(client.calls[0]?.values[5], 1);
});

test('updateDraft fails closed when the exact draft revision does not match', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });

  await assert.rejects(
    new PostgresIndustryPackVersionRepository(client).updateDraft({
      scope: { type: 'TENANT', tenantId: row.tenant_id },
      identity: { verticalKey: 'dentex', version: 2 },
      expectedRevision: 9,
      definition: DENTEX_PACK,
      updatedBySubjectId: 'editor',
    }),
    /INDUSTRY_PACK_DRAFT_UPDATE_CONFLICT/,
  );
});

test('findByIdentity keeps platform scope exact', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rows: [{ ...row, tenant_id: null, source: 'PLATFORM_AUTHORED' }],
    rowCount: 1,
  });

  const result = await new PostgresIndustryPackVersionRepository(client).findByIdentity({
    scope: { type: 'PLATFORM' },
    identity: { verticalKey: 'dentex', version: 2 },
  });

  assert.deepEqual(result?.scope, { type: 'PLATFORM' });
  assert.deepEqual(client.calls[0]?.values, [null, 'dentex', 2]);
  assert.match(client.calls[0]?.text ?? '', /\$1::uuid IS NULL AND tenant_id IS NULL/);
});

test('listVersions preserves descending database version order', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rows: [row, { ...row, version: 1, state: 'SUPERSEDED' }],
    rowCount: 2,
  });

  const result = await new PostgresIndustryPackVersionRepository(client).listVersions({
    scope: { type: 'TENANT', tenantId: row.tenant_id },
    verticalKey: 'dentex',
  });

  assert.deepEqual(result.map((item) => item.identity.version), [2, 1]);
  assert.match(client.calls[0]?.text ?? '', /ORDER BY version DESC/);
});


test('transitionLifecycle updates lifecycle metadata only when the expected state matches', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rows: [{
      ...row,
      state: 'IN_REVIEW',
      submitted_by_subject_id: 'reviewer',
      submitted_at: '2026-08-29T19:00:00.000Z',
      updated_by_subject_id: 'reviewer',
      updated_at: '2026-08-29T19:00:00.000Z',
    }],
    rowCount: 1,
  });

  const repository = new PostgresIndustryPackVersionRepository(client);
  const current = {
    identity: { verticalKey: 'dentex', version: 2 },
    scope: { type: 'TENANT' as const, tenantId: row.tenant_id },
    source: 'TENANT_AUTHORED' as const,
    state: 'DRAFT' as const,
    definition: DENTEX_PACK,
    revision: 1,
    createdBySubjectId: 'author',
    createdAt: '2026-08-29T18:00:00.000Z',
    updatedBySubjectId: 'author',
    updatedAt: '2026-08-29T18:00:00.000Z',
  };
  const next = {
    ...current,
    state: 'IN_REVIEW' as const,
    updatedBySubjectId: 'reviewer',
    updatedAt: '2026-08-29T19:00:00.000Z',
    submittedBySubjectId: 'reviewer',
    submittedAt: '2026-08-29T19:00:00.000Z',
  };

  const result = await repository.transitionLifecycle({
    scope: current.scope,
    identity: current.identity,
    expectedState: 'DRAFT',
    next,
  });

  assert.equal(result.state, 'IN_REVIEW');
  assert.equal(result.submittedBySubjectId, 'reviewer');
  assert.match(client.calls.at(-1)?.text ?? '', /AND state = \$11/);
  assert.match(client.calls.at(-1)?.text ?? '', /SET state = \$4/);
  assert.equal(client.calls.at(-1)?.values[10], 'DRAFT');
});

test('transitionLifecycle fails closed on a stale expected state', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });

  const repository = new PostgresIndustryPackVersionRepository(client);

  await assert.rejects(
    repository.transitionLifecycle({
      scope: { type: 'TENANT', tenantId: row.tenant_id },
      identity: { verticalKey: 'dentex', version: 2 },
      expectedState: 'DRAFT',
      next: {
        identity: { verticalKey: 'dentex', version: 2 },
        scope: { type: 'TENANT', tenantId: row.tenant_id },
        source: 'TENANT_AUTHORED',
        state: 'IN_REVIEW',
        definition: DENTEX_PACK,
        revision: 1,
        createdBySubjectId: 'author',
        createdAt: '2026-08-29T18:00:00.000Z',
        updatedBySubjectId: 'reviewer',
        updatedAt: '2026-08-29T19:00:00.000Z',
        submittedBySubjectId: 'reviewer',
        submittedAt: '2026-08-29T19:00:00.000Z',
      },
    }),
    /INDUSTRY_PACK_LIFECYCLE_TRANSITION_CONFLICT/,
  );
});
