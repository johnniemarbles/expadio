import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { ingestVerifiedCommunicationProviderWebhook } from '../lib/communication-provider-webhook';

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

test('Twilio sent → delivered evidence advances one canonical delivery and replays are idempotent', async () => {
  const db = pool();
  const client = await db.connect();
  const tenantId = randomUUID();
  const connectorKey = `twilio-sms-webhook-${randomUUID()}`;
  const deliveryId = randomUUID();
  const providerMessageId = `SM${randomUUID().replaceAll('-', '')}`;

  try {
    await client.query(
      `INSERT INTO platform.tenants (tenant_id, name)
       VALUES ($1::uuid, 'Twilio webhook lifecycle tenant')`,
      [tenantId],
    );
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);

    await client.query(
      `INSERT INTO platform.communication_deliveries (
         delivery_id, tenant_id, idempotency_key, channel, connector_key,
         adapter_key, provider_message_id, state, attempt_count,
         requested_at, accepted_at
       ) VALUES (
         $1::uuid, $2::uuid, $3, 'sms', $4, 'twilio-sms-whatsapp-v1',
         $5, 'ACCEPTED', 1, $6::timestamptz, $7::timestamptz
       )`,
      [
        deliveryId,
        tenantId,
        `twilio-webhook-${randomUUID()}`,
        connectorKey,
        providerMessageId,
        '2026-09-02T16:40:00.000Z',
        '2026-09-02T16:40:01.000Z',
      ],
    );

    const sent = await ingestVerifiedCommunicationProviderWebhook(client, {
      tenantId,
      providerKey: 'twilio-sms',
      connectorKey,
      providerEventId: `${providerMessageId}:sent`,
      providerMessageId,
      eventType: 'SENT',
      payload: { MessageSid: providerMessageId, MessageStatus: 'sent' },
      receivedAt: new Date('2026-09-02T16:40:02.000Z'),
    });
    assert.deepEqual(sent, {
      status: 'RECORDED',
      normalizedOutcome: 'SENT',
      deliveryId,
      previousDeliveryState: 'ACCEPTED',
      newDeliveryState: 'SENT',
      reasonCode: 'PROVIDER_WEBHOOK_SENT',
    });

    const delivered = await ingestVerifiedCommunicationProviderWebhook(client, {
      tenantId,
      providerKey: 'twilio-sms',
      connectorKey,
      providerEventId: `${providerMessageId}:delivered`,
      providerMessageId,
      eventType: 'DELIVERED',
      payload: { MessageSid: providerMessageId, MessageStatus: 'delivered' },
      receivedAt: new Date('2026-09-02T16:40:03.000Z'),
    });
    assert.deepEqual(delivered, {
      status: 'RECORDED',
      normalizedOutcome: 'DELIVERED',
      deliveryId,
      previousDeliveryState: 'SENT',
      newDeliveryState: 'DELIVERED',
      reasonCode: 'PROVIDER_WEBHOOK_DELIVERED',
    });

    const replay = await ingestVerifiedCommunicationProviderWebhook(client, {
      tenantId,
      providerKey: 'twilio-sms',
      connectorKey,
      providerEventId: `${providerMessageId}:delivered`,
      providerMessageId,
      eventType: 'DELIVERED',
      payload: { MessageSid: providerMessageId, MessageStatus: 'delivered' },
      receivedAt: new Date('2026-09-02T16:40:04.000Z'),
    });
    assert.equal(replay.status, 'DUPLICATE');
    assert.equal(replay.normalizedOutcome, 'DELIVERED');
    assert.equal(replay.deliveryId, deliveryId);

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

    const evidence = (await client.query(
      `SELECT
         (SELECT count(*)::int FROM platform.communication_provider_webhook_events
           WHERE tenant_id = $1::uuid AND delivery_id = $2::uuid) AS webhook_events,
         (SELECT count(*)::int FROM platform.communication_delivery_events
           WHERE tenant_id = $1::uuid AND delivery_id = $2::uuid
             AND provider_event_id IS NOT NULL) AS provider_delivery_events`,
      [tenantId, deliveryId],
    )).rows[0];
    assert.deepEqual(evidence, {
      webhook_events: 2,
      provider_delivery_events: 2,
    });
  } finally {
    await client.query('RESET app.tenant_id').catch(() => undefined);
    await client.query(`DELETE FROM platform.tenants WHERE tenant_id = $1::uuid`, [tenantId])
      .catch(() => undefined);
    client.release();
    await db.end();
  }
});
