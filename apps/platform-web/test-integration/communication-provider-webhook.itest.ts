import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  ingestVerifiedCommunicationProviderWebhook,
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

test('verified provider webhook updates canonical delivery lifecycle exactly once', async () => {
  const db = pool();
  const client = await db.connect();
  const tenantId = randomUUID();
  const connectorKey = `resend-webhook-${randomUUID()}`;
  const deliveryId = randomUUID();
  const providerMessageId = `resend-${randomUUID()}`;
  const providerEventId = `evt-${randomUUID()}`;

  try {
    await client.query(
      `INSERT INTO platform.tenants (tenant_id, name)
       VALUES ($1::uuid, 'Provider webhook tenant')`,
      [tenantId],
    );
    await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    await client.query(
      `INSERT INTO platform.communication_deliveries (
         delivery_id, tenant_id, idempotency_key, channel, connector_key,
         adapter_key, provider_message_id, state, attempt_count,
         requested_at, accepted_at
       ) VALUES (
         $1::uuid, $2::uuid, $3, 'email', $4, 'resend-email-v1',
         $5, 'ACCEPTED', 1, $6::timestamptz, $7::timestamptz
       )`,
      [
        deliveryId,
        tenantId,
        `delivery-${randomUUID()}`,
        connectorKey,
        providerMessageId,
        '2026-08-30T11:00:00.000Z',
        '2026-08-30T11:00:02.000Z',
      ],
    );

    const delivered = await ingestVerifiedCommunicationProviderWebhook(client, {
      tenantId,
      providerKey: 'resend',
      connectorKey,
      providerEventId,
      providerMessageId,
      eventType: 'email.delivered',
      payload: {
        type: 'email.delivered',
        data: { email_id: providerMessageId },
      },
      receivedAt: new Date('2026-08-30T11:01:00.000Z'),
    });

    assert.deepEqual(delivered, {
      status: 'RECORDED',
      normalizedOutcome: 'DELIVERED',
      deliveryId,
      previousDeliveryState: 'ACCEPTED',
      newDeliveryState: 'DELIVERED',
      reasonCode: 'PROVIDER_WEBHOOK_DELIVERED',
    });

    const persisted = (await client.query(
      `SELECT state, last_reason_code, claim_token, claim_expires_at
         FROM platform.communication_deliveries
        WHERE tenant_id = $1::uuid AND delivery_id = $2::uuid`,
      [tenantId, deliveryId],
    )).rows[0];
    assert.deepEqual(persisted, {
      state: 'DELIVERED',
      last_reason_code: 'PROVIDER_WEBHOOK_DELIVERED',
      claim_token: null,
      claim_expires_at: null,
    });

    const duplicate = await ingestVerifiedCommunicationProviderWebhook(client, {
      tenantId,
      providerKey: 'resend',
      connectorKey,
      providerEventId,
      providerMessageId,
      eventType: 'email.delivered',
      payload: {
        type: 'email.delivered',
        data: { email_id: providerMessageId },
      },
      receivedAt: new Date('2026-08-30T11:01:05.000Z'),
    });

    assert.deepEqual(duplicate, {
      status: 'DUPLICATE',
      normalizedOutcome: 'DELIVERED',
      deliveryId,
      previousDeliveryState: 'ACCEPTED',
      newDeliveryState: 'DELIVERED',
      reasonCode: 'PROVIDER_WEBHOOK_DELIVERED',
    });

    const counts = (await client.query(
      `SELECT
         (SELECT count(*)::int
            FROM platform.communication_provider_webhook_events
           WHERE tenant_id = $1::uuid) AS webhooks,
         (SELECT count(*)::int
            FROM platform.communication_delivery_events
           WHERE tenant_id = $1::uuid
             AND provider_event_id = $2) AS delivery_events`,
      [tenantId, providerEventId],
    )).rows[0];
    assert.deepEqual(counts, { webhooks: 1, delivery_events: 1 });

    const unmatched = await ingestVerifiedCommunicationProviderWebhook(client, {
      tenantId,
      providerKey: 'resend',
      connectorKey,
      providerEventId: `evt-${randomUUID()}`,
      providerMessageId: `resend-missing-${randomUUID()}`,
      eventType: 'email.delivered',
      payload: { type: 'email.delivered', data: {} },
      receivedAt: new Date('2026-08-30T11:02:00.000Z'),
    });
    assert.equal(unmatched.status, 'RECORDED');
    assert.equal(unmatched.normalizedOutcome, 'UNMATCHED');
    assert.equal(unmatched.deliveryId, null);
    assert.equal(unmatched.reasonCode, 'PROVIDER_WEBHOOK_UNMATCHED');
  } finally {
    await client.query('RESET app.tenant_id').catch(() => undefined);
    await client.query(`DELETE FROM platform.tenants WHERE tenant_id = $1::uuid`, [tenantId])
      .catch(() => undefined);
    client.release();
    await db.end();
  }
});
