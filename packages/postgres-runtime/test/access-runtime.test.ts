import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresCapabilityAvailabilityRepository } from '../src/access-runtime.ts';
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

const context = {
  subjectId: 'user-123',
  actorKind: 'user' as const,
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  organizationId: '11111111-1111-1111-1111-111111111111',
};

test('loads persisted capability state with organization-first fallback query', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rowCount: 1,
    rows: [{
      state: 'DEGRADED',
      reason_key: 'PARTIAL_PROOFS',
      blocking_step_key: 'COMPLETE_PROOFS',
      blocking_bound_key: null,
      if_you_do_nothing: ['Partial coverage remains.'],
    }],
  });

  const state = await new PostgresCapabilityAvailabilityRepository(client)
    .loadCapabilityState(context, 'email.delivery');

  assert.equal(state?.state, 'DEGRADED');
  assert.equal(state?.reasonKey, 'PARTIAL_PROOFS');
  assert.match(client.calls[0]?.text ?? '', /b\.organization_id = \$3::uuid OR b\.organization_id IS NULL/);
  assert.match(client.calls[0]?.text ?? '', /ORDER BY CASE WHEN b\.organization_id = \$3::uuid THEN 0 ELSE 1 END/);
  assert.deepEqual(client.calls[0]?.values, [
    context.tenantId,
    'email.delivery',
    context.organizationId,
  ]);
});

test('binding without resolved state fails closed as not configured', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rowCount: 1,
    rows: [{
      state: null,
      reason_key: null,
      blocking_step_key: null,
      blocking_bound_key: null,
      if_you_do_nothing: null,
    }],
  });

  const state = await new PostgresCapabilityAvailabilityRepository(client)
    .loadCapabilityState(context, 'email.delivery');

  assert.equal(state?.state, 'NOT_CONFIGURED');
  assert.equal(state?.reasonKey, 'CAPABILITY_STATE_NOT_RESOLVED');
});

test('missing binding returns null so access runtime can distinguish it', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rowCount: 0, rows: [] });

  const state = await new PostgresCapabilityAvailabilityRepository(client)
    .loadCapabilityState(context, 'email.delivery');

  assert.equal(state, null);
});
