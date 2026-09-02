import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { PostgresCommunicationDeliveryRepository } from '@expadio/postgres-runtime/delivery';
import { runCommunicationDeliveryWorkerOnce } from '../lib/communication-delivery-worker';

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

const cases = [
  {
    providerKey: 'twilio-sms',
    providerType: 'sms',
    capabilityKey: 'communication.sms.send',
    adapterKey: 'twilio-sms-whatsapp-v1',
    sender: '+15551230001',
    recipient: '+15551239991',
    body: 'EXPADIO durable SMS test',
    endpoint: '/Messages.json',
  },
  {
    providerKey: 'twilio-whatsapp',
    providerType: 'whatsapp',
    capabilityKey: 'communication.whatsapp.send',
    adapterKey: 'twilio-sms-whatsapp-v1',
    sender: '+15551230002',
    recipient: '+15551239992',
    body: 'EXPADIO durable WhatsApp test',
    endpoint: '/Messages.json',
  },
  {
    providerKey: 'twilio-voice',
    providerType: 'voice',
    capabilityKey: 'communication.voice.dial',
    adapterKey: 'twilio-voice-v1',
    sender: '+15551230003',
    recipient: '+15551239993',
    body: 'https://example.test/twiml/voice.xml',
    endpoint: '/Calls.json',
  },
] as const;

test('durable worker executes governed Twilio SMS, WhatsApp, and Voice with provider-attempt evidence', async () => {
  const db = pool();
  const client = await db.connect();
  const tenantId = randomUUID();
  const serviceSubjectId = `communication-worker-${randomUUID()}`;
  const roleKey = `communication-worker-role-${randomUUID()}`;
  const accountSid = 'AC12345678901234567890123456789012';
  const authToken = 'twilio-worker-token';

  try {
    await client.query(
      `INSERT INTO platform.tenants (tenant_id, name)
       VALUES ($1::uuid, 'Twilio communication worker tenant')`,
      [tenantId],
    );
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);

    const roleId = (await client.query(
      `INSERT INTO platform.authorization_roles
         (role_key, display_name, ownership_scope, tenant_id, status)
       VALUES ($1, 'Twilio communication delivery worker', 'TENANT', $2::uuid, 'ACTIVE')
       RETURNING role_id`,
      [roleKey, tenantId],
    )).rows[0].role_id as string;
    await client.query(
      `INSERT INTO platform.authorization_role_capabilities
         (role_id, action, resource_type)
       VALUES ($1::uuid, 'credential.lease', 'connector-credential')`,
      [roleId],
    );
    await client.query(
      `INSERT INTO platform.authorization_assignments (
         tenant_id, subject_id, role_id, status, clearances, sensitive_compartments
       ) VALUES (
         $1::uuid, $2, $3::uuid, 'ACTIVE',
         ARRAY['sensitive']::text[], ARRAY['provider-credentials']::text[]
       )`,
      [tenantId, serviceSubjectId, roleId],
    );

    for (const [index, scenario] of cases.entries()) {
      const connectorKey = `${scenario.providerKey}-worker-${randomUUID()}`;
      const idempotencyKey = `${scenario.providerKey}-${randomUUID()}`;
      const providerMessageId = `twilio-${scenario.providerType}-${randomUUID()}`;
      const requestedAt = new Date(`2026-09-02T16:0${index}:00.000Z`).toISOString();

      const capabilityId = (await client.query(
        `INSERT INTO platform.capabilities (capability_key, display_name)
         VALUES ($1, $2)
         ON CONFLICT (capability_key)
         DO UPDATE SET display_name = EXCLUDED.display_name
         RETURNING capability_id`,
        [scenario.capabilityKey, `${scenario.providerType} send`],
      )).rows[0].capability_id as string;

      const connectorId = (await client.query(
        `INSERT INTO platform.connectors (
           connector_key, provider_type, provider_key, ownership_scope, tenant_id,
           health, priority, enabled, fallback_enabled
         ) VALUES ($1, $2, $3, 'TENANT', $4::uuid, 'HEALTHY', 1, true, false)
         RETURNING connector_id`,
        [connectorKey, scenario.providerType, scenario.providerKey, tenantId],
      )).rows[0].connector_id as string;

      await client.query(
        `INSERT INTO platform.connector_capabilities (connector_id, capability_id)
         VALUES ($1::uuid, $2::uuid)`,
        [connectorId, capabilityId],
      );
      await client.query(
        `INSERT INTO platform.connector_credentials
           (connector_id, credential_ref, key_version, custody_mode, state)
         VALUES ($1::uuid, $2, 'v1', 'PLATFORM_MANAGED', 'ACTIVE')`,
        [connectorId, `vault://tenant/${tenantId}/connector/${connectorKey}/v1`],
      );
      await client.query(
        `INSERT INTO platform.communication_sender_identities (
           scope, tenant_id, channel, address, display_name, purposes,
           is_default, verification_status, status
         ) VALUES (
           'TENANT', $1::uuid, $2, $3, 'EXPADIO',
           ARRAY['transactional']::text[], true, 'VERIFIED', 'ACTIVE'
         )`,
        [tenantId, scenario.providerType, scenario.sender],
      );
      await client.query(
        `INSERT INTO platform.communication_consent_events (
           tenant_id, recipient_key, channel, purpose, event_type, source,
           policy_version, evidence_ref, effective_at
         ) VALUES (
           $1::uuid, $2, $3, 'transactional', 'GRANTED', 'SYSTEM',
           'communication-worker-twilio-itest-v1', $4, $5::timestamptz
         )`,
        [
          tenantId,
          scenario.recipient,
          scenario.providerType,
          `itest://communication-consent/${scenario.providerType}`,
          requestedAt,
        ],
      );

      const dispatch = {
        tenantId,
        triggerKey: `certification.${scenario.providerType}`,
        purpose: 'transactional' as const,
        channel: scenario.providerType,
        recipient: { phone: scenario.recipient },
        recipientKey: scenario.recipient,
        idempotencyKey,
        templateScope: 'TENANT' as const,
        rendered: {
          templateId: `${scenario.providerType}-certification-v1`,
          version: 1,
          channel: scenario.providerType,
          locale: 'en',
          format: 'TEXT' as const,
          body: scenario.body,
          variables: {},
        },
        compliance: {
          preflight: {
            allowed: true as const,
            reasonCode: 'OK' as const,
            reason: 'Queue-time preflight passed.',
          },
          evaluatedAt: requestedAt,
        },
        routing: { capabilityKey: scenario.capabilityKey },
        requestedAt,
      };

      const delivery = await new PostgresCommunicationDeliveryRepository(client).createOrGet({
        tenantId,
        idempotencyKey,
        channel: scenario.providerType,
        connectorKey,
        adapterKey: scenario.adapterKey,
        requestedAt,
        dispatchSnapshot: { dispatch, consentRequired: false },
      });

      let providerCalls = 0;
      const result = await runCommunicationDeliveryWorkerOnce(client, {
        tenantId,
        options: {
          serviceSubjectId,
          now: () => new Date(requestedAt),
          secretResolver: {
            async resolve() {
              return {
                value: JSON.stringify({ accountSid, authToken }),
                version: 'v1',
              };
            },
          },
          fetchImpl: async (input, init) => {
            providerCalls += 1;
            assert.ok(String(input).endsWith(scenario.endpoint));
            const headers = new Headers(init?.headers);
            const expectedAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
            assert.equal(headers.get('Authorization'), `Basic ${expectedAuth}`);

            const form = new URLSearchParams(String(init?.body));
            assert.equal(form.get('To'), scenario.providerType === 'whatsapp'
              ? `whatsapp:${scenario.recipient}`
              : scenario.recipient);
            if (scenario.providerType === 'voice') {
              assert.equal(form.get('From'), scenario.sender);
              assert.equal(form.get('Url'), scenario.body);
            } else {
              assert.equal(form.get('From'), scenario.providerType === 'whatsapp'
                ? `whatsapp:${scenario.sender}`
                : scenario.sender);
              assert.equal(form.get('Body'), scenario.body);
            }

            return new Response(JSON.stringify({ sid: providerMessageId }), {
              status: 201,
              headers: { 'content-type': 'application/json' },
            });
          },
        },
      });

      assert.deepEqual(result, {
        status: 'ACCEPTED',
        deliveryId: delivery.deliveryId,
        reasonCode: 'PROVIDER_ACCEPTED',
      });
      assert.equal(providerCalls, 1);

      const persisted = (await client.query(
        `SELECT state, provider_message_id, attempt_count, last_reason_code
           FROM platform.communication_deliveries
          WHERE tenant_id = $1::uuid AND delivery_id = $2::uuid`,
        [tenantId, delivery.deliveryId],
      )).rows[0];
      assert.equal(persisted.state, 'ACCEPTED');
      assert.equal(persisted.provider_message_id, providerMessageId);
      assert.equal(persisted.attempt_count, 1);
      assert.equal(persisted.last_reason_code, 'PROVIDER_ACCEPTED');

      const providerEvidence = await client.query(
        `SELECT connector_key, provider_key, adapter_key, outcome, provider_message_id
           FROM platform.communication_provider_attempts
          WHERE tenant_id = $1::uuid AND delivery_id = $2::uuid`,
        [tenantId, delivery.deliveryId],
      );
      assert.equal(providerEvidence.rowCount, 1);
      assert.deepEqual(providerEvidence.rows[0], {
        connector_key: connectorKey,
        provider_key: scenario.providerKey,
        adapter_key: scenario.adapterKey,
        outcome: 'ACCEPTED',
        provider_message_id: providerMessageId,
      });
    }
  } finally {
    await client.query('RESET app.tenant_id').catch(() => undefined);
    await client.query(
      `DELETE FROM platform.tenants WHERE tenant_id = $1::uuid`,
      [tenantId],
    ).catch(() => undefined);
    client.release();
    await db.end();
  }
});