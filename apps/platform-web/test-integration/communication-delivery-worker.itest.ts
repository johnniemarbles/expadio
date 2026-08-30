import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { PostgresCommunicationDeliveryRepository } from '@expadio/postgres-runtime/delivery';
import {
  runCommunicationDeliveryWorkerOnce,
} from '../lib/communication-delivery-worker';

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

test('provider acceptance reconciles when the delivery claim expires before finalization', async () => {
  const db = pool();
  const client = await db.connect();
  const tenantId = randomUUID();
  const connectorKey = `resend-worker-${randomUUID()}`;
  const serviceSubjectId = `communication-worker-${randomUUID()}`;
  const idempotencyKey = `delivery-${randomUUID()}`;
  const providerMessageId = `resend-${randomUUID()}`;
  const roleKey = `communication-worker-role-${randomUUID()}`;
  const initialNow = new Date('2026-08-30T10:30:00.000Z');
  let clock = initialNow;

  try {
    await client.query(
      `INSERT INTO platform.tenants (tenant_id, name)
       VALUES ($1::uuid, 'Communication worker tenant')`,
      [tenantId],
    );
    await client.query(
      "SELECT set_config('app.tenant_id', $1, false)",
      [tenantId],
    );

    const capabilityId = (await client.query(
      `INSERT INTO platform.capabilities (capability_key, display_name)
       VALUES ('communication.email.send', 'Email send')
       ON CONFLICT (capability_key)
       DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING capability_id`,
    )).rows[0].capability_id as string;

    const connectorId = (await client.query(
      `INSERT INTO platform.connectors (
         connector_key, provider_type, provider_key, ownership_scope, tenant_id,
         health, priority, enabled, fallback_enabled
       ) VALUES (
         $1, 'email', 'resend', 'TENANT', $2::uuid,
         'HEALTHY', 1, true, false
       )
       RETURNING connector_id`,
      [connectorKey, tenantId],
    )).rows[0].connector_id as string;

    await client.query(
      `INSERT INTO platform.connector_capabilities (connector_id, capability_id)
       VALUES ($1::uuid, $2::uuid)`,
      [connectorId, capabilityId],
    );
    await client.query(
      `INSERT INTO platform.connector_credentials
         (connector_id, credential_ref, key_version, custody_mode, state)
       VALUES (
         $1::uuid,
         $2,
         'v1',
         'PLATFORM_MANAGED',
         'ACTIVE'
       )`,
      [connectorId, `vault://tenant/${tenantId}/connector/${connectorKey}/v1`],
    );

    await client.query(
      `INSERT INTO platform.communication_sender_identities (
         scope, tenant_id, channel, address, display_name, purposes,
         is_default, verification_status, status
       ) VALUES (
         'TENANT', $1::uuid, 'email', 'sender@example.test', 'EXPADIO',
         ARRAY['transactional']::text[], true, 'VERIFIED', 'ACTIVE'
       )`,
      [tenantId],
    );

    const roleId = (await client.query(
      `INSERT INTO platform.authorization_roles
         (role_key, display_name, ownership_scope, tenant_id, status)
       VALUES ($1, 'Communication delivery worker', 'TENANT', $2::uuid, 'ACTIVE')
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
         tenant_id, subject_id, role_id, status,
         clearances, sensitive_compartments
       ) VALUES (
         $1::uuid, $2, $3::uuid, 'ACTIVE',
         ARRAY['sensitive']::text[],
         ARRAY['provider-credentials']::text[]
       )`,
      [tenantId, serviceSubjectId, roleId],
    );

    const dispatch = {
      tenantId,
      triggerKey: 'patient.follow_up',
      purpose: 'transactional' as const,
      channel: 'email' as const,
      recipient: { email: 'patient@example.test' },
      recipientKey: 'patient@example.test',
      idempotencyKey,
      templateScope: 'TENANT' as const,
      rendered: {
        templateId: 'follow-up-v1',
        version: 1,
        channel: 'email' as const,
        locale: 'en',
        format: 'TEXT' as const,
        subject: 'Treatment follow-up',
        body: 'Your follow-up is ready.',
        variables: {},
      },
      compliance: {
        preflight: {
          allowed: true as const,
          reasonCode: 'OK' as const,
          reason: 'Queue-time preflight passed.',
        },
        evaluatedAt: new Date(initialNow.getTime() - 60_000).toISOString(),
      },
      routing: { capabilityKey: 'communication.email.send' },
      requestedAt: new Date(initialNow.getTime() - 60_000).toISOString(),
    };

    const delivery = await new PostgresCommunicationDeliveryRepository(client)
      .createOrGet({
        tenantId,
        idempotencyKey,
        channel: 'email',
        connectorKey,
        adapterKey: 'resend-email-v1',
        requestedAt: dispatch.requestedAt,
        dispatchSnapshot: {
          dispatch,
          consentRequired: false,
        },
      });

    const providerCalls: Array<{ url: string; body: unknown; idempotency: string | null }> = [];
    const result = await runCommunicationDeliveryWorkerOnce(client, {
      tenantId,
      options: {
        serviceSubjectId,
        now: () => clock,
        leaseMs: 1_000,
        secretResolver: {
          async resolve() {
            return { value: 're_worker_test_token', version: 'v1' };
          },
        },
        fetchImpl: async (input, init) => {
          // The provider accepts after the renewed 1-second claim lease has expired.
          // Claim-bound finalization must fail, then acceptance evidence reconciles.
          clock = new Date(initialNow.getTime() + 2_000);
          const headers = new Headers(init?.headers);
          providerCalls.push({
            url: String(input),
            body: JSON.parse(String(init?.body)),
            idempotency: headers.get('Idempotency-Key'),
          });
          assert.equal(headers.get('Authorization'), 'Bearer re_worker_test_token');
          return new Response(JSON.stringify({ id: providerMessageId }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    });

    assert.deepEqual(result, {
      status: 'ACCEPTED',
      deliveryId: delivery.deliveryId,
      reasonCode: 'PROVIDER_ACCEPTED_RECONCILED',
    });
    assert.equal(providerCalls.length, 1);
    assert.equal(providerCalls[0]?.url, 'https://api.resend.com/emails');
    assert.equal(providerCalls[0]?.idempotency, idempotencyKey);

    const persisted = (await client.query(
      `SELECT state, provider_message_id, attempt_count, claim_token,
              claim_expires_at, last_reason_code
         FROM platform.communication_deliveries
        WHERE tenant_id = $1::uuid AND delivery_id = $2::uuid`,
      [tenantId, delivery.deliveryId],
    )).rows[0];

    assert.equal(persisted.state, 'ACCEPTED');
    assert.equal(persisted.provider_message_id, providerMessageId);
    assert.equal(persisted.attempt_count, 1);
    assert.equal(persisted.claim_token, null);
    assert.equal(persisted.claim_expires_at, null);
    assert.equal(persisted.last_reason_code, 'PROVIDER_ACCEPTED_RECONCILED');

    const evidence = await client.query(
      `SELECT reason_code, from_state, to_state, attempt_token
         FROM platform.communication_delivery_events
        WHERE tenant_id = $1::uuid AND delivery_id = $2::uuid
        ORDER BY recorded_at, event_id`,
      [tenantId, delivery.deliveryId],
    );
    assert.deepEqual(
      evidence.rows.map((row) => ({
        reason: row.reason_code,
        from: row.from_state,
        to: row.to_state,
        hasAttemptToken: row.attempt_token !== null,
      })),
      [
        {
          reason: 'DELIVERY_CLAIMED',
          from: 'PENDING',
          to: 'PENDING',
          hasAttemptToken: true,
        },
        {
          reason: 'DELIVERY_CLAIM_RENEWED',
          from: 'PENDING',
          to: 'PENDING',
          hasAttemptToken: true,
        },
        {
          reason: 'PROVIDER_ACCEPTED_RECONCILED',
          from: 'PENDING',
          to: 'ACCEPTED',
          hasAttemptToken: true,
        },
      ],
    );


    const providerEvidence = await client.query(
      `SELECT outcome, provider_message_id, idempotency_key, attempt_token
         FROM platform.communication_provider_attempts
        WHERE tenant_id = $1::uuid AND delivery_id = $2::uuid`,
      [tenantId, delivery.deliveryId],
    );
    assert.equal(providerEvidence.rowCount, 1);
    assert.deepEqual(providerEvidence.rows[0], {
      outcome: 'ACCEPTED',
      provider_message_id: providerMessageId,
      idempotency_key: idempotencyKey,
      attempt_token: providerEvidence.rows[0].attempt_token,
    });
    assert.ok(providerEvidence.rows[0].attempt_token);

    const leaseEvidence = await client.query(
      `SELECT outcome, requested_by_subject_id, connector_key
         FROM platform.credential_lease_events
        WHERE tenant_id = $1::uuid AND connector_key = $2
        ORDER BY recorded_at DESC
        LIMIT 1`,
      [tenantId, connectorKey],
    );
    assert.equal(leaseEvidence.rowCount, 1);
    assert.equal(leaseEvidence.rows[0].outcome, 'ISSUED');
    assert.equal(leaseEvidence.rows[0].requested_by_subject_id, serviceSubjectId);
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
