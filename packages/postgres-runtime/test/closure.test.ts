import assert from 'node:assert/strict';
import test from 'node:test';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import { PostgresClosureRepository } from '../src/closure.ts';

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

test('governanceClosure maps rows from platform.governance_closure()', async () => {
  const client = new Client();
  client.steps.push({
    rows: [{ node_id: 'brand-hq', depth: 0, path: ['brand-hq'], node_type: 'BRAND_HQ', display_name: 'Brand HQ' }],
    rowCount: 1,
  });
  const repo = new PostgresClosureRepository(client);

  const nodes = await repo.governanceClosure('brand-hq', 'tenant-1');

  assert.match(client.calls[0]?.text ?? '', /platform\.governance_closure\(\$1\)/);
  assert.equal(client.calls[0]?.values[0], 'brand-hq');
  assert.deepEqual(nodes, [{ nodeId: 'brand-hq', depth: 0, path: ['brand-hq'], nodeType: 'BRAND_HQ', displayName: 'Brand HQ' }]);
});

test('territorialClosure maps rows from platform.territorial_closure()', async () => {
  const client = new Client();
  client.steps.push({
    rows: [{ node_id: 'unit-1', node_type: 'UNIT', display_name: 'Toronto Unit', effective_from: '2026-01-01' }],
    rowCount: 1,
  });
  const repo = new PostgresClosureRepository(client);

  const nodes = await repo.territorialClosure('state-master-ontario', 'tenant-1');

  assert.match(client.calls[0]?.text ?? '', /platform\.territorial_closure\(\$1\)/);
  assert.deepEqual(nodes, [{ nodeId: 'unit-1', nodeType: 'UNIT', displayName: 'Toronto Unit', effectiveFrom: '2026-01-01' }]);
});

test('isReachable calls platform.node_is_reachable() with the purpose', async () => {
  const client = new Client();
  client.steps.push({ rows: [{ node_is_reachable: true }], rowCount: 1 });
  const repo = new PostgresClosureRepository(client);

  const reachable = await repo.isReachable('brand-hq', 'unit-1', 'GOVERNANCE', 'tenant-1');

  assert.equal(reachable, true);
  assert.deepEqual(client.calls[0]?.values, ['brand-hq', 'unit-1', 'GOVERNANCE']);
});

test('isReachable returns false when no row comes back', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 });
  const repo = new PostgresClosureRepository(client);

  assert.equal(await repo.isReachable('brand-hq', 'unrelated', 'COMMERCIAL', 'tenant-1'), false);
});

test('governanceRoot returns the resolved root node id', async () => {
  const client = new Client();
  client.steps.push({ rows: [{ governance_root: 'brand-hq' }], rowCount: 1 });
  const repo = new PostgresClosureRepository(client);

  const root = await repo.governanceRoot('unit-1', 'tenant-1');

  assert.equal(root, 'brand-hq');
  assert.match(client.calls[0]?.text ?? '', /platform\.governance_root\(\$1\)/);
});

test('governanceRoot throws when the node cannot be resolved at all', async () => {
  const client = new Client();
  client.steps.push({ rows: [{ governance_root: null }], rowCount: 1 });
  const repo = new PostgresClosureRepository(client);

  await assert.rejects(() => repo.governanceRoot('missing-node', 'tenant-1'), /GOVERNANCE_ROOT_UNRESOLVED/);
});

test('territorialAuthority returns null when none is configured', async () => {
  const client = new Client();
  client.steps.push({ rows: [{ territorial_authority: null }], rowCount: 1 });
  const repo = new PostgresClosureRepository(client);

  assert.equal(await repo.territorialAuthority('unit-1', 'tenant-1'), null);
});

test('territorialAuthority returns the configured authority node id', async () => {
  const client = new Client();
  client.steps.push({ rows: [{ territorial_authority: 'state-master-ontario' }], rowCount: 1 });
  const repo = new PostgresClosureRepository(client);

  assert.equal(await repo.territorialAuthority('unit-1', 'tenant-1'), 'state-master-ontario');
});
