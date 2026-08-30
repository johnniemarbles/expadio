import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import type { ConnectorDefinition } from '@expadio/provider-registry';
import { credentialReference } from '@expadio/provider-registry';
import { governedResendApiTokenProvider } from '@expadio/communication/governed-resend-binding';
import { ResendEmailAdapter } from '@expadio/communication/resend-email-adapter';
import { PostgresConnectorCredentialRepository } from '@expadio/postgres-runtime/provider-registry';
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

test('missing credential.lease grant denies before Vault or Resend is touched', async () => {
  const db = pool();
  const client = await db.connect();
  const tenantId = randomUUID();
  const organizationId = randomUUID();
  const subjectId = `gp3b-denied-${randomUUID()}`;
  const connectorKey = `resend-denied-${randomUUID()}`;
  const roleKey = `communications-reader-${randomUUID()}`;
  const credentialRef = credentialReference(
    `vault://tenant/${tenantId}/connector/${connectorKey}/v1`,
  );
  let vaultReads = 0;
  let resendCalls = 0;

  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO platform.tenants (tenant_id, name) VALUES ($1::uuid, 'GP3b Denied Tenant')`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO platform.organizations (organization_id, tenant_id, name)
       VALUES ($1::uuid, $2::uuid, 'GP3b Denied Organization')`,
      [organizationId, tenantId],
    );
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await client.query(`SELECT set_config('app.organization_id', $1, true)`, [organizationId]);
    await client.query(`SELECT set_config('app.subject_id', $1, true)`, [subjectId]);

    const role = await client.query<{ role_id: string }>(
      `INSERT INTO platform.authorization_roles
         (role_key, display_name, ownership_scope, tenant_id)
       VALUES ($1, 'GP3b communications reader', 'TENANT', $2::uuid)
       RETURNING role_id`,
      [roleKey, tenantId],
    );
    const roleId = role.rows[0]!.role_id;
    await client.query(
      `INSERT INTO platform.authorization_role_capabilities
         (role_id, action, resource_type)
       VALUES ($1::uuid, 'read', 'connector-credential')`,
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

    const connectorRow = await client.query<{ connector_id: string }>(
      `INSERT INTO platform.connectors
         (connector_key, provider_type, provider_key, ownership_scope, tenant_id,
          health, priority, enabled, fallback_enabled)
       VALUES ($1, 'email', 'resend', 'TENANT', $2::uuid,
               'HEALTHY', 1, true, false)
       RETURNING connector_id`,
      [connectorKey, tenantId],
    );
    await client.query(
      `INSERT INTO platform.connector_credentials
         (connector_id, credential_ref, key_version, custody_mode, state)
       VALUES ($1::uuid, $2, 'v1', 'PLATFORM_MANAGED', 'ACTIVE')`,
      [connectorRow.rows[0]!.connector_id, credentialRef],
    );

    const connector: ConnectorDefinition = {
      connectorKey,
      providerType: 'email',
      providerKey: 'resend',
      ownership: 'TENANT',
      tenantId,
      capabilityKeys: ['communication.email.send'],
      credentialRef,
      residencyTags: [],
      complianceTags: [],
      health: 'HEALTHY',
      priority: 1,
      enabled: true,
      fallbackEnabled: false,
    };

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
      now: () => '2026-08-30T06:10:00.000Z',
      decisionId: () => 'gp3b-denied-decision',
      leaseId: () => 'gp3b-denied-lease',
      issuerAuditId: () => 'gp3b-denied-issuer-audit',
      auditEventId: () => randomUUID(),
    });

    const vaultResolver = new VaultDelegatedSecretResolver({
      address: 'https://vault.test',
      token: 'vault-test-token',
      fetchImpl: async () => {
        vaultReads += 1;
        return new Response(JSON.stringify({
          data: { data: { secret: 'must-not-be-read' }, metadata: { version: 1 } },
        }), { status: 200 });
      },
    });

    const adapter = new ResendEmailAdapter({
      apiToken: governedResendApiTokenProvider({
        connector,
        credentialRepository: new PostgresConnectorCredentialRepository(client),
        leaseService,
        secretResolver: vaultResolver,
        requestedBySubjectId: subjectId,
        requestId: () => 'gp3b-denied-request',
        correlationId: () => randomUUID(),
        now: () => '2026-08-30T06:10:00.000Z',
      }),
      fetchImpl: async () => {
        resendCalls += 1;
        return new Response(JSON.stringify({ id: 'must-not-send' }), { status: 200 });
      },
    });

    await assert.rejects(
      adapter.send({
        tenantId,
        organizationId,
        triggerKey: 'communications.test-send',
        purpose: 'system',
        channel: 'email',
        recipient: { email: 'recipient@example.test' },
        recipientKey: 'recipient@example.test',
        sender: {
          senderKey: 'gp3b-denied-sender',
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
          body: 'This send must be denied.',
          variables: {},
        },
        idempotencyKey: `gp3b-denied-${randomUUID()}`,
        requestedAt: '2026-08-30T06:09:59.000Z',
      }),
      (error: unknown) =>
        (error as { code?: string }).code === 'CREDENTIAL_LEASE_ACCESS_DENIED',
    );

    assert.equal(vaultReads, 0, 'authorization denial must happen before Vault');
    assert.equal(resendCalls, 0, 'authorization denial must happen before Resend');

    const leaseEvents = await client.query(
      `SELECT count(*)::int AS total
         FROM platform.credential_lease_events
        WHERE tenant_id = $1::uuid`,
      [tenantId],
    );
    assert.equal(
      leaseEvents.rows[0].total,
      0,
      'current runtime must not claim an issued lease when authorization denies',
    );

    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await db.end();
  }
});
