import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  ingestVerifiedCommunicationProviderWebhook,
  type CommunicationDeliveryLifecycleState,
} from '../lib/communication-provider-webhook';

function pool(): pg.Pool {
  return new pg.Pool({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    database: process.env.PGDATABASE ?? 'expadio_test',
    max: 1,
  });
}

async function insertDelivery(
  client: pg.PoolClient,
  input: {
    readonly tenantId: string;
    readonly deliveryId: string;
    readonly connectorKey: string;
    readonly providerMessageId: string;
    readonly state: CommunicationDeliveryLifecycleState;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO platform.communication_deliveries (
       delivery_id, tenant_id, idempotency_key, channel, connector_key,
       adapter_key, provider_message_id, state, attempt_count,
       requested_at, accepted_at
     ) VALUES (
       $1::uuid, $2::uuid, $3, 'email', $4, 'resend-email-v1',
       $5, $6, 1, $7::timestamptz, $8::timestamptz
     )`,
    [
      input.deliveryId,
      input.tenantId,
      `delivery-${randomUUID()}`,
      input.connectorKey,
      input.providerMessageId,
      input.state,
      '2026-08-30T12:00:00.000Z',
      '2026-08-30T12:00:02.000Z',
    ],
  );
}

test('out-of-order provider webhooks are recorded without stale state regression', async () => {
  const db = pool();
  const client = await db.connect();
  const tenantId = randomUUID();
  const connectorKey = `resend-lifecycle-${randomUUID()}`;
  const deliveryId = randomUUID();
  const providerMessageId = `resend-${randomUUID()}`;

  try {
    await client.query(
      `INSERT INTO platform.tenants (tenant_id, name)
       VALUES ($1::uuid, 'Provider lifecycle tenant')`,
      [tenantId],
    );
    await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    await insertDelivery(client, {
      tenantId,
      deliveryId,
      connectorKey,
      providerMessageId,
      state: 'DELIVERED',
    });

    const staleSentEventId = `evt-${randomUUID()}`;
    const staleSent = await ingestVerifiedCommunicationProviderWebhook(client, {
      tenantId,
      providerKey: 'resend',
      connectorKey,
      providerEventId: staleSentEventId,
      providerMessageId,
      eventType: 'email.sent',
      payload: { type: 'email.sent', data: { email_id: providerMessageId } },
      receivedAt: new Date('2026-08-30T12:01:00.000Z'),
    });

    assert.deepEqual(staleSent, {
      status: 'RECORDED',
      normalizedOutcome: 'SENT',
      deliveryId,
      previousDeliveryState: 'DELIVERED',
      newDeliveryState: 'DELIVERED',
      reasonCode: 'PROVIDER_WEBHOOK_STATE_TRANSITION_IGNORED',
    });

    const bouncedEventId = `evt-${randomUUID()}`;
    const bounced = await ingestVerifiedCommunicationProviderWebhook(client, {
      tenantId,
      providerKey: 'resend',
      connectorKey,
      providerEventId: bouncedEventId,
      providerMessageId,
      eventType: 'email.bounced',
      payload: { type: 'email.bounced', data: { email_id: providerMessageId } },
      receivedAt: new Date('2026-08-30T12:02:00.000Z'),
    });

    assert.deepEqual(bounced, {
      status: 'RECORDED',
      normalizedOutcome: 'BOUNCED',
      deliveryId,
      previousDeliveryState: 'DELIVERED',
      newDeliveryState: 'BOUNCED',
      reasonCode: 'PROVIDER_WEBHOOK_BOUNCED',
    });

    const staleDeliveredEventId = `evt-${randomUUID()}`;
    const staleDelivered = await ingestVerifiedCommunicationProviderWebhook(client, {
      tenantId,
      providerKey: 'resend',
      connectorKey,
      providerEventId: staleDeliveredEventId,
      providerMessageId,
      eventType: 'email.delivered',
      payload: { type: 'email.delivered', data: { email_id: providerMessageId } },
      receivedAt: new Date('2026-08-30T12:03:00.000Z'),
    });

    assert.deepEqual(staleDelivered, {
      status: 'RECORDED',
      normalizedOutcome: 'DELIVERED',
      deliveryId,
      previousDeliveryState: 'BOUNCED',
      newDeliveryState: 'BOUNCED',
      reasonCode: 'PROVIDER_WEBHOOK_STATE_TRANSITION_IGNORED',
    });

    const complainedEventId = `evt-${randomUUID()}`;
    const complained = await ingestVerifiedCommunicationProviderWebhook(client, {
      tenantId,
      providerKey: 'resend',
      connectorKey,
      providerEventId: complainedEventId,
      providerMessageId,
      eventType: 'email.complained',
      payload: { type: 'email.complained', data: { email_id: providerMessageId } },
      receivedAt: new Date('2026-08-30T12:04:00.000Z'),
    });

    assert.deepEqual(complained, {
      status: 'RECORDED',
      normalizedOutcome: 'COMPLAINED',
      deliveryId,
      previousDeliveryState: 'BOUNCED',
      newDeliveryState: 'COMPLAINED',
      reasonCode: 'PROVIDER_WEBHOOK_COMPLAINED',
    });

    const persisted = (await client.query(
      `SELECT state, last_reason_code
         FROM platform.communication_deliveries
        WHERE tenant_id = $1::uuid AND delivery_id = $2::uuid`,
      [tenantId, deliveryId],
    )).rows[0];
    assert.deepEqual(persisted, {
      state: 'COMPLAINED',
      last_reason_code: 'PROVIDER_WEBHOOK_COMPLAINED',
    });

    const eventCounts = (await client.query(
      `SELECT
         (SELECT count(*)::int
            FROM platform.communication_provider_webhook_events
           WHERE tenant_id = $1::uuid
             AND delivery_id = $2::uuid) AS webhook_events,
         (SELECT count(*)::int
            FROM platform.communication_delivery_events
           WHERE tenant_id = $1::uuid
             AND delivery_id = $2::uuid) AS delivery_events,
         (SELECT count(*)::int
            FROM platform.communication_delivery_events
           WHERE tenant_id = $1::uuid
             AND delivery_id = $2::uuid
             AND provider_event_id = $3) AS stale_sent_delivery_events,
         (SELECT count(*)::int
            FROM platform.communication_delivery_events
           WHERE tenant_id = $1::uuid
             AND delivery_id = $2::uuid
             AND provider_event_id = $4) AS stale_delivered_delivery_events`,
      [tenantId, deliveryId, staleSentEventId, staleDeliveredEventId],
    )).rows[0];
    assert.deepEqual(eventCounts, {
      webhook_events: 4,
      delivery_events: 2,
      stale_sent_delivery_events: 0,
      stale_delivered_delivery_events: 0,
    });
  } finally {
    await client.query('RESET app.tenant_id').catch(() => undefined);
    await client.query(`DELETE FROM platform.tenants WHERE tenant_id = $1::uuid`, [tenantId])
      .catch(() => undefined);
    client.release();
    await db.end();
  }
});

test('replayed provider webhooks with distinct event ids do not duplicate delivery lifecycle mutations', async () => {
  const db = pool();
  const client = await db.connect();
  const tenantId = randomUUID();
  const connectorKey = `resend-replay-${randomUUID()}`;
  const deliveryId = randomUUID();
  const providerMessageId = `resend-${randomUUID()}`;

  try {
    await client.query(
      `INSERT INTO platform.tenants (tenant_id, name)
       VALUES ($1::uuid, 'Provider replay tenant')`,
      [tenantId],
    );
    await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    await insertDelivery(client, {
      tenantId,
      deliveryId,
      connectorKey,
      providerMessageId,
      state: 'ACCEPTED',
    });

    const firstDeliveredEventId = `evt-${randomUUID()}`;
    const firstDelivered = await ingestVerifiedCommunicationProviderWebhook(client, {
      tenantId,
      providerKey: 'resend',
      connectorKey,
      providerEventId: firstDeliveredEventId,
      providerMessageId,
      eventType: 'email.delivered',
      payload: { type: 'email.delivered', data: { email_id: providerMessageId } },
      receivedAt: new Date('2026-08-30T12:05:00.000Z'),
    });

    assert.deepEqual(firstDelivered, {
      status: 'RECORDED',
      normalizedOutcome: 'DELIVERED',
      deliveryId,
      previousDeliveryState: 'ACCEPTED',
      newDeliveryState: 'DELIVERED',
      reasonCode: 'PROVIDER_WEBHOOK_DELIVERED',
    });

    const replayedDeliveredEventId = `evt-${randomUUID()}`;
    const replayedDelivered = await ingestVerifiedCommunicationProviderWebhook(client, {
      tenantId,
      providerKey: 'resend',
      connectorKey,
      providerEventId: replayedDeliveredEventId,
      providerMessageId,
      eventType: 'email.delivered',
      payload: { type: 'email.delivered', data: { email_id: providerMessageId } },
      receivedAt: new Date('2026-08-30T12:05:05.000Z'),
    });

    assert.deepEqual(replayedDelivered, {
      status: 'RECORDED',
      normalizedOutcome: 'DELIVERED',
      deliveryId,
      previousDeliveryState: 'DELIVERED',
      newDeliveryState: 'DELIVERED',
      reasonCode: 'PROVIDER_WEBHOOK_STATE_ALREADY_APPLIED',
    });

    const persisted = (await client.query(
      `SELECT state, last_reason_code
         FROM platform.communication_deliveries
        WHERE tenant_id = $1::uuid AND delivery_id = $2::uuid`,
      [tenantId, deliveryId],
    )).rows[0];
    assert.deepEqual(persisted, {
      state: 'DELIVERED',
      last_reason_code: 'PROVIDER_WEBHOOK_DELIVERED',
    });

    const eventCounts = (await client.query(
      `SELECT
         (SELECT count(*)::int
            FROM platform.communication_provider_webhook_events
           WHERE tenant_id = $1::uuid
             AND delivery_id = $2::uuid) AS webhook_events,
         (SELECT count(*)::int
            FROM platform.communication_delivery_events
           WHERE tenant_id = $1::uuid
             AND delivery_id = $2::uuid) AS delivery_events,
         (SELECT count(*)::int
            FROM platform.communication_delivery_events
           WHERE tenant_id = $1::uuid
             AND delivery_id = $2::uuid
             AND provider_event_id = $3) AS first_delivery_events,
         (SELECT count(*)::int
            FROM platform.communication_delivery_events
           WHERE tenant_id = $1::uuid
             AND delivery_id = $2::uuid
             AND provider_event_id = $4) AS replayed_delivery_events`,
      [tenantId, deliveryId, firstDeliveredEventId, replayedDeliveredEventId],
    )).rows[0];
    assert.deepEqual(eventCounts, {
      webhook_events: 2,
      delivery_events: 1,
      first_delivery_events: 1,
      replayed_delivery_events: 0,
    });
  } finally {
    await client.query('RESET app.tenant_id').catch(() => undefined);
    await client.query(`DELETE FROM platform.tenants WHERE tenant_id = $1::uuid`, [tenantId])
      .catch(() => undefined);
    client.release();
    await db.end();
  }
});
