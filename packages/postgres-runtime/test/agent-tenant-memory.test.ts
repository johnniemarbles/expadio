import assert from 'node:assert/strict';
import test from 'node:test';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import {
  getAgentTenantMemory,
  upsertAgentTenantMemory,
  PostgresAgentArtifactStore,
} from '../src/agent-tenant-memory.ts';

class Client implements PostgresClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly steps: Array<SqlQueryResult> = [];

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ) {
    this.calls.push({ text, values });
    const step = this.steps.shift() ?? { rows: [], rowCount: 0 };
    return step as SqlQueryResult<Row>;
  }
}

test('upsertAgentTenantMemory issues an insert-or-update keyed on tenant and memory key', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 1 });

  await upsertAgentTenantMemory(client, {
    tenantId: 'tenant-1',
    memoryKey: 'editorial-debate:exec-1',
    memoryValue: { fullCopy: 'Draft' },
  });

  assert.match(client.calls[0]?.text ?? '', /INSERT INTO platform\.agent_tenant_memory/);
  assert.match(client.calls[0]?.text ?? '', /ON CONFLICT \(tenant_id, memory_key\)/);
  assert.equal(client.calls[0]?.values[0], 'tenant-1');
  assert.equal(client.calls[0]?.values[1], 'editorial-debate:exec-1');
  assert.equal(client.calls[0]?.values[2], JSON.stringify({ fullCopy: 'Draft' }));
});

test('getAgentTenantMemory maps a found row', async () => {
  const client = new Client();
  client.steps.push({
    rows: [
      {
        tenant_id: 'tenant-1',
        memory_key: 'editorial-debate:exec-1',
        memory_value: { fullCopy: 'Draft' },
        metadata: {},
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    rowCount: 1,
  });

  const record = await getAgentTenantMemory(client, 'tenant-1', 'editorial-debate:exec-1');

  assert.deepEqual(record?.memoryValue, { fullCopy: 'Draft' });
});

test('getAgentTenantMemory returns null when nothing matches', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 });

  const record = await getAgentTenantMemory(client, 'tenant-1', 'missing-key');

  assert.equal(record, null);
});

test('PostgresAgentArtifactStore.save delegates to the memory upsert', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 1 });

  const store = new PostgresAgentArtifactStore(client);
  await store.save({ tenantId: 'tenant-1', key: 'editorial-debate:exec-2', value: { fullCopy: 'Other draft' } });

  assert.match(client.calls[0]?.text ?? '', /INSERT INTO platform\.agent_tenant_memory/);
  assert.equal(client.calls[0]?.values[1], 'editorial-debate:exec-2');
});
