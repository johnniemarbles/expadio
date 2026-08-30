import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { DecisionTraceBuilder } from '@expadio/communication';
import { governedResendApiTokenProvider } from '@expadio/communication/governed-resend-binding';
import { ResendEmailAdapter } from '@expadio/communication/resend-email-adapter';
import {
  PostgresConnectorCredentialRepository,
  PostgresProviderRegistryRepository,
} from '@expadio/postgres-runtime/provider-registry';
import { createGovernedCredentialLeaseRuntime } from '@expadio/postgres-runtime/governed-credential-lease-runtime';
import { VaultDelegatedSecretResolver } from '../lib/vault-secret-resolver.ts';

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

test('governed Resend golden path persists lease + TEST_SEND_OK evidence', async () => {
  const db = pool();
  const client = await db.connect();
  const tenantId = randomUUID();
  const organizationId = randomUUID();
  const subjectId = `gp3b-subject-${randomUUID()}`;
  const connectorKey = `resend-gp3b-${randomUUID()}`;
  const roleKey = `communications-operator-${randomUUID()}`;
  const credentialRef = `vault://tenant/${tenantId}/connector/${connectorKey}/v3`;
  const idempotencyKey = `gp3b-${randomUUID()}`;
  const providerMessageId = `resend-${randomUUID()}`;
  const staticNow = '2026-08-30T06:00:00.000Z';
  const requestedAt = '2026-08-30T05:59:59.000Z';
  const leaseEventId = randomUUID();
  const correlationId = randomUUID();
  const traceId = randomUUID();

  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO platform.tenants (tenant_id, name) VALUES ($1::uuid, 'GP3b Tenant')`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO platform.organizations (organization_id, tenant_id, name)
       VALUES ($1::uuid, $2::uuid, 'GP3b Organization')`,
      [organizationId, tenantId],
    );
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await client.query(`SELECT set_config('app.organization_id', $1, true)`, [organizationId]);
    await client.query(`SELECT set_config('app.subject_id', $1, true)`, [subjectId]);

    const role = await client.query<{ role_id: string }>(
      `INSERT INTO platform.authorization_roles
         (role_key, display_name, ownership_scope, tenant_id)
       VALUES ($1, 'GP3b communications operator', 'TENANT', $2::uuid)
       RETURNING role_id`,
      [roleKey, tenantId],
    );
    const roleId = role.rows[0]!.role_id;
    await client.query(
      `INSERT INTO platform.authorization_role_capabilities
         (role_id, action, resource_type)
       VALUES ($1::uuid, 'credential.lease', 'connector-credential')`,
      [roleId],
    );
    await client.query(
      `INSERT INTO platform.authorization_assignments
         (tenant_id, organization_id, subject_id, role_id,
          action_organization_ids, clearances, sensitive_compartments)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, ARRAY[$2::uuid],
               ARRAY['sensitive']::text[], ARRAY['provider-credentials']::text[])`,
      [tenantId, organizationId, subjectId, roleId],
    );

    const capability = await client.query<{ capability_id: string }>(
      `INSERT INTO platform.capabilities
         (capability_key, display_name, permitted_modes, enabled)
       VALUES ('communication.email.send', 'Email send', ARRAY['A']::text[], true)
       ON CONFLICT (capability_key)
       DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING capability_id`,
    );
    const capabilityId = capability.rows[0]!.capability_id;
    const connector = await client.query<{ connector_id: string }>(
      `INSERT INTO platform.connectors
         (connector_key, provider_type, provider_key, ownership_scope, tenant_id,
          health, priority, enabled, fallback_enabled)
       VALUES ($1, 'email', 'resend', 'TENANT', $2::uuid,
               'HEALTHY', 1, true, false)
       RETURNING connector_id`,
      [connectorKey, tenantId],
    );
    const connectorId = connector.rows[0]!.connector_id;
    await client.query(
      `INSERT INTO platform.connector_capabilities (connector_id, capability_id)
       VALUES ($1::uuid, $2::uuid)`,
      [connectorId, capabilityId],
    );
    await client.query(
      `INSERT INTO platform.connector_credentials
         (connector_id, credential_ref, key_version, custody_mode, state)
       VALUES ($1::uuid, $2, 'v3', 'PLATFORM_MANAGED', 'ACTIVE')`,
      [connectorId, credentialRef],
    );

    const registry = new PostgresProviderRegistryRepository(client);
    const connectors = await registry.listConnectors(tenantId, 'communication.email.send');
    const selected = connectors.find((item) => item.connectorKey === connectorKey);
    assert.ok(selected, 'persisted Resend connector must resolve from the registry');

    let vaultReads = 0;
    const vaultResolver = new VaultDelegatedSecretResolver({
      address: 'https://vault.test',
      token: 'vault-test-token',
      mount: 'expadio',
      fetchImpl: async (input) => {
        vaultReads += 1;
        const url = String(input);
        assert.match(url, new RegExp(`/tenant/${tenantId}/connector/${connectorKey}\\?version=3$`));
        return new Response(JSON.stringify({
          data: { data: { secret: 're_gp3b_secret' }, metadata: { version: 3 } },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const leaseService = createGovernedCredentialLeaseRuntime({
      client,
      contextProvider: {
        async resolve() {
          return {
            subjectId,
            actorKind: 'user',
            tenantId,
            organizationId,
          };
        },
      },
      now: () => staticNow,
      decisionId: () => 'gp3b-authorization-decision',
      leaseId: () => 'gp3b-lease',
      issuerAuditId: () => 'gp3b-issuer-audit',
      auditEventId: () => leaseEventId,
    });

    const adapter = new ResendEmailAdapter({
      apiToken: governedResendApiTokenProvider({
        connector: selected,
        credentialRepository: new PostgresConnectorCredentialRepository(client),
        leaseService,
        secretResolver: vaultResolver,
        requestedBySubjectId: subjectId,
        requestId: () => 'gp3b-request',
        correlationId: () => correlationId,
        now: () => staticNow,
      }),
      now: () => staticNow,
      fetchImpl: async (input, init) => {
        assert.equal(String(input), 'https://api.resend.com/emails');
        const headers = new Headers(init?.headers);
        assert.equal(headers.get('Authorization'), 'Bearer re_gp3b_secret');
        assert.equal(headers.get('Idempotency-Key'), idempotencyKey);
        const payload = JSON.parse(String(init?.body)) as {
          from: string;
          to: string[];
          subject: string;
          text?: string;
        };
        assert.equal(payload.from, 'EXPADIO Test <verified@example.test>');
        assert.deepEqual(payload.to, ['recipient@example.test']);
        assert.equal(payload.subject, 'EXPADIO communication test');
        return new Response(JSON.stringify({ id: providerMessageId }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const providerResult = await adapter.send({
      tenantId,
      organizationId,
      triggerKey: 'communications.test-send',
      purpose: 'system',
      channel: 'email',
      recipient: { email: 'recipient@example.test' },
      sender: {
        address: 'verified@example.test',
        displayName: 'EXPADIO Test',
      },
      rendered: {
        templateId: 'platform-test-send',
        version: 1,
        channel: 'email',
        locale: 'en',
        format: 'TEXT',
        subject: 'EXPADIO communication test',
        body: 'Governed test send.',
        variables: {},
      },
      idempotencyKey,
      requestedAt,
    });

    assert.equal(providerResult.status, 'ACCEPTED');
    assert.equal(providerResult.providerMessageId, providerMessageId);
    assert.equal(vaultReads, 1);

    const lease = await client.query(
      `SELECT outcome, credential_reference, authorization_reason_key,
              issued_at, expires_at, evidence_refs
         FROM platform.credential_lease_events
        WHERE tenant_id = $1::uuid AND request_id = 'gp3b-request'`,
      [tenantId],
    );
    assert.equal(lease.rowCount, 1);
    assert.equal(lease.rows[0].outcome, 'ISSUED');
    assert.equal(lease.rows[0].authorization_reason_key, 'GRANTED');
    assert.equal(lease.rows[0].credential_reference, credentialRef);
    assert.equal(
      new Date(lease.rows[0].expires_at).getTime() - new Date(lease.rows[0].issued_at).getTime(),
      60_000,
    );
    assert.ok(lease.rows[0].evidence_refs.includes(
      'communication://trigger/communications.test-send',
    ));
    assert.ok(lease.rows[0].evidence_refs.includes(
      `communication://idempotency/${encodeURIComponent(idempotencyKey)}`,
    ));

    const trace = new DecisionTraceBuilder(() => Date.parse(staticNow))
      .pass('INTENT_VALIDATION', 'behavioral integration test')
      .pass('SENDER_DOMAIN', 'verified tenant sender')
      .pass('CONNECTOR_ROUTING', `selected ${connectorKey}`)
      .pass('CREDENTIAL_LEASE', 'authorized audited 60-second lease')
      .pass('DISPATCH', 'Resend accepted request')
      .pass('OUTCOME_CLASSIFICATION', 'provider accepted test message')
      .build({
        traceId,
        tenantId,
        organizationId,
        kind: 'DISPATCH',
        outcome: 'SENT',
        reasonCode: 'TEST_SEND_OK',
        correlationId,
        createdAt: staticNow,
      });

    await client.query(
      `INSERT INTO platform.communication_decision_traces
         (trace_id, tenant_id, organization_id, message_id, kind, outcome,
          reason_code, stopped_at_gate, gates, connectors_considered,
          connectors_rejected, compliance_pack_versions, correlation_id,
          expires_at, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, $4, $5, $6, $7,
               $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::uuid,
               $13::timestamptz, $14::timestamptz)`,
      [
        trace.traceId,
        trace.tenantId,
        trace.organizationId,
        trace.kind,
        trace.outcome,
        trace.reasonCode ?? null,
        trace.stoppedAtGate ?? null,
        JSON.stringify(trace.gates),
        JSON.stringify(trace.connectorsConsidered),
        JSON.stringify(trace.connectorsRejected),
        JSON.stringify(trace.compliancePackVersions),
        trace.correlationId,
        trace.expiresAt,
        trace.createdAt,
      ],
    );

    const evidence = await client.query(
      `SELECT count(*)::int AS total
         FROM platform.communication_decision_traces
        WHERE tenant_id = $1::uuid
          AND outcome = 'SENT'
          AND reason_code = 'TEST_SEND_OK'`,
      [tenantId],
    );
    assert.equal(evidence.rows[0].total, 1);

    const persisted = JSON.stringify({
      credential: (await client.query(
        `SELECT credential_ref FROM platform.connector_credentials WHERE connector_id = $1::uuid`,
        [connectorId],
      )).rows,
      lease: lease.rows,
      trace: (await client.query(
        `SELECT reason_code, gates FROM platform.communication_decision_traces WHERE trace_id = $1::uuid`,
        [traceId],
      )).rows,
    });
    assert.doesNotMatch(persisted, /re_gp3b_secret/);

    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await db.end();
  }
});
