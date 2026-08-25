import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresCommunicationDeliveryRepository } from '../src/delivery.ts';
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
  delivery_id: '11111111-1111-1111-1111-111111111111',
  tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  organization_id: null,
  idempotency_key: 'idem-1',
  channel: 'email',
  connector_key: 'email-primary',
  adapter_key: 'resend-runtime',
  provider_message_id: null,
  state: 'PENDING',
  attempt_count: 0,
  last_reason_code: null,
  last_reason: null,
  requested_at: '2026-08-25T05:00:00.000Z',
  accepted_at: null,
  updated_at: '2026-08-25T05:00:00.000Z',
};

test('recordAttempt increments attempt count and appends a same-state event', async () => {
  const client = new ScriptedClient();
  client.responses.push(
    { rows: [row], rowCount: 1 },
    {
      rows: [{
        ...row,
        attempt_count: 1,
        last_reason_code: 'RATE_LIMITED',
        updated_at: '2026-08-25T05:01:00.000Z',
      }],
      rowCount: 1,
    },
    { rows: [], rowCount: 1 },
  );

  const result = await new PostgresCommunicationDeliveryRepository(client).recordAttempt({
    tenantId: row.tenant_id,
    deliveryId: row.delivery_id,
    occurredAt: '2026-08-25T05:01:00.000Z',
    reasonCode: 'RATE_LIMITED',
  });

  assert.equal(result.attemptCount, 1);
  assert.equal(result.state, 'PENDING');
  assert.match(client.calls[0]?.text ?? '', /FOR UPDATE/);
  assert.match(client.calls[1]?.text ?? '', /attempt_count = attempt_count \+ 1/);
  assert.match(client.calls[2]?.text ?? '', /from_state, to_state/);
});
