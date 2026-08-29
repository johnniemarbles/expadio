import assert from 'node:assert/strict';
import test from 'node:test';
import { DENTEX_PACK } from '@expadio/industry-packs';
import { PostgresIndustryPackRuntimeResolver } from '../src/industry-pack-runtime.ts';
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

test('tenant published pack wins before platform and code baseline', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rows: [{
      tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      vertical_key: 'dentex',
      version: 7,
      definition: { ...DENTEX_PACK, label: 'Tenant DENTEX v7' },
    }],
    rowCount: 1,
  });

  const result = await new PostgresIndustryPackRuntimeResolver(client).resolve({
    tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    verticalKey: ' DENTEX ',
  });

  assert.equal(result.pack?.label, 'Tenant DENTEX v7');
  assert.deepEqual(result.provenance, {
    verticalKey: 'dentex',
    version: 7,
    source: 'TENANT_PUBLISHED',
    scope: 'TENANT',
  });
  assert.equal(client.calls.length, 1);
  assert.deepEqual(client.calls[0]?.values, [
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'dentex',
  ]);
});

test('platform published pack is used when tenant has no published override', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });
  client.responses.push({
    rows: [{
      tenant_id: null,
      vertical_key: 'dentex',
      version: 3,
      definition: { ...DENTEX_PACK, label: 'Platform DENTEX v3' },
    }],
    rowCount: 1,
  });

  const result = await new PostgresIndustryPackRuntimeResolver(client).resolve({
    tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    verticalKey: 'dentex',
  });

  assert.equal(result.provenance.source, 'PLATFORM_PUBLISHED');
  assert.equal(result.provenance.version, 3);
  assert.equal(client.calls.length, 2);
  assert.deepEqual(client.calls[1]?.values, [null, 'dentex']);
});

test('registered code baseline remains the final compatibility fallback', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });
  client.responses.push({ rows: [], rowCount: 0 });

  const result = await new PostgresIndustryPackRuntimeResolver(client).resolve({
    tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    verticalKey: 'dentex',
  });

  assert.equal(result.pack?.verticalKey, 'dentex');
  assert.deepEqual(result.provenance, {
    verticalKey: 'dentex',
    version: null,
    source: 'CODE_BASELINE',
    scope: 'CODE',
  });
});

test('no vertical binding resolves to neutral without database reads', async () => {
  const client = new ScriptedClient();

  const result = await new PostgresIndustryPackRuntimeResolver(client).resolve({
    tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    verticalKey: null,
  });

  assert.equal(result.pack, null);
  assert.equal(result.provenance.source, 'NEUTRAL');
  assert.equal(client.calls.length, 0);
});

test('unknown vertical fails after persisted and code sources are exhausted', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });
  client.responses.push({ rows: [], rowCount: 0 });

  await assert.rejects(
    () => new PostgresIndustryPackRuntimeResolver(client).resolve({
      tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      verticalKey: 'unknown',
    }),
    (error: any) => error?.code === 'INDUSTRY_PACK_RUNTIME_NOT_FOUND',
  );
});
