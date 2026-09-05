import assert from 'node:assert/strict';
import test from 'node:test';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import {
  PostgresGovernancePolicyRepository,
  upsertEntityGovernanceConfig,
} from '../src/entity-governance.ts';

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

test('PostgresGovernancePolicyRepository resolves a configured policy via the SQL function', async () => {
  const client = new Client();
  client.steps.push({ rows: [{ resolve_publishing_policy: 'STATE_MASTER_SIGN_OFF' }], rowCount: 1 });

  const repo = new PostgresGovernancePolicyRepository(client);
  const policy = await repo.resolveConfiguredPolicy('node-1', 'tenant-1');

  assert.equal(policy, 'STATE_MASTER_SIGN_OFF');
  assert.match(client.calls[0]?.text ?? '', /platform\.resolve_publishing_policy\(\$1, \$2\)/);
  assert.deepEqual(client.calls[0]?.values, ['tenant-1', 'node-1']);
});

test('PostgresGovernancePolicyRepository returns null when no ancestor has a configured policy', async () => {
  const client = new Client();
  client.steps.push({ rows: [{ resolve_publishing_policy: null }], rowCount: 1 });

  const repo = new PostgresGovernancePolicyRepository(client);
  const policy = await repo.resolveConfiguredPolicy('node-1', 'tenant-1');

  assert.equal(policy, null);
});

test('upsertEntityGovernanceConfig issues an insert-or-update against entity_governance_config', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 1 });

  await upsertEntityGovernanceConfig(client, {
    tenantId: 'tenant-1',
    nodeId: 'node-1',
    publishingPolicy: 'DIRECT_AUTONOMOUS',
    updatedBy: 'sub-admin',
  });

  assert.match(client.calls[0]?.text ?? '', /INSERT INTO platform\.entity_governance_config/);
  assert.match(client.calls[0]?.text ?? '', /ON CONFLICT \(tenant_id, node_id\)/);
  assert.deepEqual(client.calls[0]?.values, ['tenant-1', 'node-1', 'DIRECT_AUTONOMOUS', 'sub-admin']);
});
