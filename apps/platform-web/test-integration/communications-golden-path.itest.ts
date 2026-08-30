import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { DecisionTraceBuilder } from '@expadio/communication';
import { governedResendApiTokenProvider } from '@expadio/communication/governed-resend-binding';
import { routePreparedCommunicationDispatch } from '@expadio/communication/dispatch-routing';
import type { PreparedCommunicationDispatch } from '@expadio/communication/dispatch';
import { prepareCommunicationProviderSendRequest } from '@expadio/communication/provider-send-request';
import { ResendEmailAdapter } from '@expadio/communication/resend-email-adapter';
import {
  PostgresConnectorCredentialRepository,
  PostgresProviderRegistryRepository,
} from '@expadio/postgres-runtime/provider-registry';
import { PostgresCommunicationSenderRepository } from '@expadio/postgres-runtime/sender';
import {
  createGovernedCredentialLeaseRuntime,
} from '@expadio/postgres-runtime/governed-credential-lease-runtime';
import { VaultDelegatedSecretResolver } from '../lib/vault-secret-resolver.ts';

const CAPABILITY_KEY = 'communication.email.send';

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

test('governed Resend golden path persists lease evidence and TEST_SEND_OK trace', async () => {
  const p = pool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');

    const tenantId = randomUUID();
    const organizationId = randomUUID();
    const subjectId = `subject-${randomUUID()}`;
    const connectorKey = `resend-${randomUUID()}`;
    const roleKey = `communications-operator-${randomUUID()}`;
    const requestedAt = '2026-08-30T05:40:00.000Z';
    const issuedAt = '2026-08-30T05:40:01.000Z';
    const recipient = 'golden-path@example.test';
    const idempotencyKey = `itest-${randomUUID()}`;

    await client.query(
      `INSERT INTO platform.tenants (tenant_id, name) VALUES ($1::uuid, 'Communications GP3b')`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO platform.organizations (organization_id, tenant_id, name)
       VALUES ($1::uuid, $2::uuid, 'Communications GP3b Org')`,
      [organizationId, tenantId],
    );
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

    const capability = await client.query<{ capability_id: string }>(
      `INSERT INTO platform.capabilities (capability_key, display_name)
       VALUES ($1, 'Communication email send')
       ON CONFLICT (capability_key)
       DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING capability_id`,
      [CAPABILITY_KEY],
    );
    const capabilityId = capability.rows[0]!.capability_id;

    const connector = await client.query<{ connector_id: string }>(
      `INSERT INTO platform.connectors
         (connector_key, provider_type, provider_key, ownership_scope, tenant_id,
          health, priority, enabled, fallback_enabled)
       VALUES ($1, 'email', 'resend', 'TENANT', $2::uuid, 'HEALTHY', 1, true, false)
       RETURNING connector_id`,
      [connectorKey, tenantId],
    );
    const connectorId = connector.rows[0]!.connector_id;

    await client.query(
      `INSERT INTO platform.connector_capabilities (connector_id, capability_id)
       VALUES ($1::uuid, $2::uuid)`,
      [connectorId, capabilityId],
    );

    const credentialReference =
      `vault://tenant/${tenantId}/connector/${connectorKey}/v3`;
    await client.query(
      `INSERT INTO platform.connector_credentials
         (connector_id, credential_ref, key_version, custody_mode, state)
       VALUES ($1::uuid, $2, 'v3', 'DELEGATED', 'ACTIVE')`,
      [connectorId, credentialReference],
    );

    await client.query(
      `INSERT INTO platform.communication_sender_identities
         (scope, tenant_id, channel, address, display_name, purposes,
          is_default, verification_status, status)
       VALUES ('TENANT', $1::uuid, 'email', 'sender@example.test', 'EXPADIO',
               ARRAY['system']::text[], true, 'VERIFIED', 'ACTIVE')`,
      [tenantId],
    );

    const role = await client.query<{ role_id: string }>(
      `INSERT INTO platform.authorization_roles
         (role_key, display_name, ownership_scope, tenant_id, status)
       VALUES ($1, 'Communications operator', 'TENANT', $2::uuid, 'ACTIVE')
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
         (tenant_id, organization_id, subject_id, role_id, status,
          action_organization_ids, clearances, sensitive_compartments)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, 'ACTIVE',
               ARRAY[$2::uuid], ARRAY['sensitive']::text[],
               ARRAY['provider-credentials']::text[])`,
      [tenantId, organizationId, subjectId, roleId],
    );

    const providerRegistry = new PostgresProviderRegistryRepository(client);
    const connectors = await providerRegistry.listConnectors(tenantId, CAPABILITY_KEY);
    const selected = connectors.filter((item) => item.connectorKey === connectorKey);
    assert.equal(selected.length, 1);
    const selectedConnector = selected[0]!;
    assert.deepEqual(selectedConnector.capabilityKeys, [CAPABILITY_KEY]);

    const dispatch: PreparedCommunicationDispatch = {
      tenantId,
      organizationId,
      triggerKey: 'communications.test-send',
      purpose: 'system',
      channel: 'email',
      recipient: { email: recipient },
      recipientKey: recipient,
      idempotencyKey,
      templateScope: 'PLATFORM',
      rendered: {
        templateId: 'platform-test-send',
        version: 1,
        channel: 'email',
        locale: 'en',
        format: 'TEXT',
        subject: 'EXPADIO communication test',
        body: 'Governed GP3b integration test.',
        variables: {},
      },
      compliance: {
        preflight: {
          allowed: true,
          reasonCode: 'OK',
          reason: 'Integration-test operator boundary.',
        },
        evaluatedAt: requestedAt,
      },
      routing: { capabilityKey: CAPABILITY_KEY },
      requestedAt,
    };

    const routed = routePreparedCommunicationDispatch(dispatch, selected);
    assert.equal(routed.routed, true);
    if (!routed.routed) throw new Error('expected routed dispatch');

    const senderPrepared = await prepareCommunicationProviderSendRequest({
      dispatch,
      senderRepository: new PostgresCommunicationSenderRepository(client),
      platformFallback: 'DENY',
    });
    assert.equal(senderPrepared.ok, true);
    if (!senderPrepared.ok) throw new Error(senderPrepared.reasonCode);

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
      now: () => issuedAt,
      decisionId: () => 'gp3b-decision',
      leaseId: () => 'gp3b-lease',
      issuerAuditId: () => 'gp3b-issuer-audit',
      auditEventId: () => randomUUID(),
    });

    const vaultCalls: string[] = [];
    const vaultResolver = new VaultDelegatedSecretResolver({
      address: 'https://vault.gp3b.test',
      token: 'vault-test-token',
      mount: 'expadio',
      fetchImpl: async (input) => {
        vaultCalls.push(String(input));
        return new Response(
          JSON.stringify({
            data: {
              data: { secret: 're_gp3b_test_token' },
              metadata: { version: 3 },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    const providerCalls: Array<{ url: string; init?: RequestInit }> = [];
    const adapter = new ResendEmailAdapter({
      apiToken: governedResendApiTokenProvider({
        connector: selectedConnector,
        credentialRepository: new PostgresConnectorCredentialRepository(client),
        leaseService,
        secretResolver: vaultResolver,
        requestedBySubjectId: subjectId,
        requestId: () => `gp3b-request-${randomUUID()}`,
        correlationId: () => randomUUID(),
        now: () => issuedAt,
      }),
      fetchImpl: async (input, init) => {
        providerCalls.push({ url: String(input), init });
        return new Response(
          JSON.stringify({ id: 'resend-gp3b-message' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
      now: () => '2026-08-30T05:40:02.000Z',
    });

    const providerResult = await adapter.send(senderPrepared.request);
    assert.equal(providerResult.status, 'ACCEPTED');
    assert.equal(providerResult.providerMessageId, 'resend-gp3b-message');
    assert.equal(providerCalls.length, 1);
    assert.equal(providerCalls[0]?.url, 'https://api.resend.com/emails');
    assert.equal(
      new Headers(providerCalls[0]?.init?.headers).get('Authorization'),
      'Bearer re_gp3b_test_token',
    );
    assert.equal(
      new Headers(providerCalls[0]?.init?.headers).get('Idempotency-Key'),
      idempotencyKey,
    );

    assert.equal(vaultCalls.length, 1);
    assert.equal(
      vaultCalls[0],
      `https://vault.gp3b.test/v1/expadio/data/tenant/${tenantId}/connector/${connectorKey}?version=3`,
    );

    const leaseEvidence = await client.query<{
      outcome: string;
      authorization_reason_key: string;
      credential_reference: string;
      issued_at: Date;
      expires_at: Date;
    }>(
      `SELECT outcome, authorization_reason_key, credential_reference, issued_at, expires_at
       FROM platform.credential_lease_events
       WHERE tenant_id = $1::uuid AND connector_key = $2
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [tenantId, connectorKey],
    );
    assert.equal(leaseEvidence.rows.length, 1);
    assert.equal(leaseEvidence.rows[0]?.outcome, 'ISSUED');
    assert.equal(leaseEvidence.rows[0]?.credential_reference, credentialReference);
    assert.equal(
      (leaseEvidence.rows[0]!.expires_at.getTime() - leaseEvidence.rows[0]!.issued_at.getTime()) / 1000,
      60,
    );

    const traceBuilder = new DecisionTraceBuilder();
    traceBuilder
      .pass('INTENT_VALIDATION', 'integration test intent accepted')
      .pass('SENDER_DOMAIN', `verified sender scope ${senderPrepared.senderScope}`);
    traceBuilder.routing({
      considered: routed.considered,
      rejected: routed.rejected,
    });
    traceBuilder
      .pass('CONNECTOR_ROUTING', `selected ${connectorKey}`)
      .pass('CREDENTIAL_LEASE', 'authorized, audited, short-lived credential lease issued')
      .pass('DISPATCH', 'test message handed to Resend')
      .pass('OUTCOME_CLASSIFICATION', 'provider accepted test message');

    const trace = traceBuilder.build({
      traceId: randomUUID(),
      tenantId,
      organizationId,
      kind: 'DISPATCH',
      outcome: 'SENT',
      reasonCode: 'TEST_SEND_OK',
      correlationId: randomUUID(),
      createdAt: requestedAt,
    });

    await client.query(
      `INSERT INTO platform.communication_decision_traces
         (trace_id, tenant_id, organization_id, message_id, kind, outcome, reason_code,
          stopped_at_gate, gates, connectors_considered, connectors_rejected,
          compliance_pack_versions, correlation_id, expires_at, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, $4, $5, $6, $7,
               $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12,
               $13::timestamptz, $14::timestamptz)`,
      [
        trace.traceId,
        trace.tenantId,
        trace.organizationId ?? null,
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

    const persistedTrace = await client.query<{
      outcome: string;
      reason_code: string;
      gates: Array<{ gate: string; verdict: string }>;
    }>(
      `SELECT outcome, reason_code, gates
       FROM platform.communication_decision_traces
       WHERE tenant_id = $1::uuid AND trace_id = $2::uuid`,
      [tenantId, trace.traceId],
    );
    assert.equal(persistedTrace.rows[0]?.outcome, 'SENT');
    assert.equal(persistedTrace.rows[0]?.reason_code, 'TEST_SEND_OK');
    const passedGates = new Set(
      (persistedTrace.rows[0]?.gates ?? [])
        .filter((gate) => gate.verdict === 'PASS')
        .map((gate) => gate.gate),
    );
    assert.equal(passedGates.has('CREDENTIAL_LEASE'), true);
    assert.equal(passedGates.has('DISPATCH'), true);
    assert.equal(passedGates.has('OUTCOME_CLASSIFICATION'), true);
  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
      await p.end();
    }
  }
});
