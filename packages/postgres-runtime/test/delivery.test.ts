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
  dispatch_snapshot: {
    dispatch: {
      tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      triggerKey: 'patient.follow_up',
      purpose: 'transactional',
      channel: 'email',
      recipient: { email: 'patient@example.test' },
      recipientKey: 'patient@example.test',
      idempotencyKey: 'idem-1',
      templateScope: 'PLATFORM',
      rendered: {
        templateId: 'template-1',
        version: 1,
        channel: 'email',
        locale: 'en',
        format: 'TEXT',
        subject: 'Follow-up',
        body: 'Hello',
        variables: {},
      },
      compliance: {
        preflight: { allowed: true, reasonCode: 'OK', reason: 'allowed' },
        evaluatedAt: '2026-08-25T05:00:00.000Z',
      },
      routing: { capabilityKey: 'communication.email.send' },
      requestedAt: '2026-08-25T05:00:00.000Z',
    },
    consentRequired: false,
  },
  next_attempt_at: '2026-08-25T05:00:00.000Z',
  last_attempt_at: null,
  claim_token: null,
  claim_expires_at: null,
};

test('createOrGet uses tenant idempotency and maps the durable record', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [row], rowCount: 1 });
  const result = await new PostgresCommunicationDeliveryRepository(client).createOrGet({
    tenantId: row.tenant_id,
    idempotencyKey: row.idempotency_key,
    channel: 'email',
    connectorKey: row.connector_key,
    adapterKey: row.adapter_key,
    requestedAt: row.requested_at,
    dispatchSnapshot: row.dispatch_snapshot,
  });
  assert.equal(result.deliveryId, row.delivery_id);
  assert.equal(result.state, 'PENDING');
  assert.match(client.calls[0]?.text ?? '', /ON CONFLICT \(tenant_id, idempotency_key\)/);
  assert.match(client.calls[0]?.text ?? '', /dispatch_snapshot/);
  assert.equal(result.dispatchSnapshot?.dispatch.triggerKey, 'patient.follow_up');
});

test('applyTransition locks, updates, and appends an event', async () => {
  const client = new ScriptedClient();
  client.responses.push(
    { rows: [row], rowCount: 1 },
    { rows: [{ exists: false }], rowCount: 1 },
    {
      rows: [{
        ...row,
        provider_message_id: 'provider-1',
        state: 'ACCEPTED',
        attempt_count: 1,
        accepted_at: '2026-08-25T05:01:00.000Z',
        updated_at: '2026-08-25T05:01:00.000Z',
      }],
      rowCount: 1,
    },
    { rows: [], rowCount: 1 },
  );

  const result = await new PostgresCommunicationDeliveryRepository(client).applyTransition({
    tenantId: row.tenant_id,
    deliveryId: row.delivery_id,
    providerMessageId: 'provider-1',
    incrementAttempt: true,
    transition: {
      from: 'PENDING',
      to: 'ACCEPTED',
      occurredAt: '2026-08-25T05:01:00.000Z',
      providerEventId: 'event-1',
    },
  });

  assert.equal(result.applied, true);
  assert.equal(result.delivery.state, 'ACCEPTED');
  assert.equal(result.delivery.attemptCount, 1);
  assert.match(client.calls[0]?.text ?? '', /FOR UPDATE/);
  assert.match(client.calls[3]?.text ?? '', /communication_delivery_events/);
});

test('duplicate provider events are idempotent and skip mutation', async () => {
  const client = new ScriptedClient();
  client.responses.push(
    { rows: [row], rowCount: 1 },
    { rows: [{ exists: true }], rowCount: 1 },
  );

  const result = await new PostgresCommunicationDeliveryRepository(client).applyTransition({
    tenantId: row.tenant_id,
    deliveryId: row.delivery_id,
    transition: {
      from: 'PENDING',
      to: 'ACCEPTED',
      occurredAt: '2026-08-25T05:01:00.000Z',
      providerEventId: 'event-duplicate',
    },
  });

  assert.equal(result.applied, false);
  assert.equal(client.calls.length, 2);
});

test('stale from-state fails before update', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [{ ...row, state: 'SENT' }], rowCount: 1 });

  await assert.rejects(
    () => new PostgresCommunicationDeliveryRepository(client).applyTransition({
      tenantId: row.tenant_id,
      deliveryId: row.delivery_id,
      transition: {
        from: 'ACCEPTED',
        to: 'DELIVERED',
        occurredAt: '2026-08-25T05:02:00.000Z',
      },
    }),
    /COMMUNICATION_DELIVERY_STALE_FROM_STATE:ACCEPTED->SENT/,
  );
});
