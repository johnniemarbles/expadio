import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  approveEnterpriseProfileConfiguration,
  loadEnterpriseProfileConfiguration,
  requestEnterpriseProfileConfiguration,
} from '@expadio/postgres-runtime/enterprise-profile';

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

test('bootstrap enterprise -> governed profile configuration -> independent approval', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const rootOrganizationId = randomUUID();

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, status)
       VALUES ($1::uuid, 'Profile onboarding integration', 'ACTIVE')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    await c.query(
      `INSERT INTO platform.organizations (
         organization_id, tenant_id, organization_kind, name, status
       ) VALUES ($1::uuid, $2::uuid, 'GLOBAL_HQ', 'Bootstrap HQ', 'ACTIVE')`,
      [rootOrganizationId, tenantId],
    );

    const organization = await c.query<{ enterprise_id: string }>(
      `SELECT enterprise_id
         FROM platform.organizations
        WHERE tenant_id = $1::uuid
          AND organization_id = $2::uuid`,
      [tenantId, rootOrganizationId],
    );
    const enterpriseId = organization.rows[0]?.enterprise_id;
    assert.ok(enterpriseId);

    const before = await loadEnterpriseProfileConfiguration(c, {
      tenantId,
      enterpriseId,
    });
    assert.equal(before.configurationState, 'BOOTSTRAPPED');
    assert.equal(before.rootOrganizationId, rootOrganizationId);

    await c.query('BEGIN');
    const submitted = await requestEnterpriseProfileConfiguration(c, {
      tenantId,
      enterpriseId,
      rootOrganizationId,
      name: 'Global Dreamware Group',
      mode: 'GLOBAL',
      requestedBySubjectId: 'profile-requester',
      correlationId: 'profile-config-correlation',
      idempotencyKey: 'profile-config-request',
    });
    await c.query('COMMIT');

    assert.equal(submitted.idempotent, false);
    assert.equal(submitted.request.status, 'SUBMITTED');
    assert.equal(submitted.request.proposedMode, 'GLOBAL');

    await c.query('BEGIN');
    const replay = await requestEnterpriseProfileConfiguration(c, {
      tenantId,
      enterpriseId,
      rootOrganizationId,
      name: 'Global Dreamware Group',
      mode: 'GLOBAL',
      requestedBySubjectId: 'profile-requester',
      correlationId: 'profile-config-replay',
      idempotencyKey: 'profile-config-request',
    });
    await c.query('COMMIT');

    assert.equal(replay.idempotent, true);
    assert.equal(replay.request.requestId, submitted.request.requestId);

    await c.query('BEGIN');
    await assert.rejects(
      () =>
        approveEnterpriseProfileConfiguration(c, {
          tenantId,
          enterpriseId,
          requestId: submitted.request.requestId,
          approverOrganizationId: rootOrganizationId,
          decidedBySubjectId: 'profile-requester',
        }),
      /ENTERPRISE_SEPARATION_OF_DUTIES_REQUIRED/,
    );
    await c.query('ROLLBACK');

    await c.query('BEGIN');
    const approved = await approveEnterpriseProfileConfiguration(c, {
      tenantId,
      enterpriseId,
      requestId: submitted.request.requestId,
      approverOrganizationId: rootOrganizationId,
      decidedBySubjectId: 'profile-approver',
      decisionReason: 'Global enterprise profile approved',
    });
    await c.query('COMMIT');

    assert.equal(approved.idempotent, false);
    assert.equal(approved.request.status, 'APPROVED');
    assert.equal(approved.profile.configurationState, 'CONFIGURED');
    assert.equal(approved.profile.name, 'Global Dreamware Group');
    assert.equal(approved.profile.mode, 'GLOBAL');
    assert.equal(approved.profile.rootOrganizationId, rootOrganizationId);
    assert.equal(approved.profile.configuredBySubjectId, 'profile-approver');
    assert.ok(approved.profile.configuredAt);

    const events = await c.query<{ event_type: string; correlation_id: string }>(
      `SELECT event_type, correlation_id
         FROM platform.domain_events
        WHERE tenant_id = $1::uuid
          AND aggregate_type = 'enterprise.profile'
          AND aggregate_id = $2
        ORDER BY occurred_at, event_type`,
      [tenantId, enterpriseId],
    );
    const types = events.rows.map((row) => row.event_type);
    assert.ok(types.includes('enterprise.profile.configuration_requested'));
    assert.ok(types.includes('enterprise.profile.configured'));
    assert.ok(
      events.rows.some(
        (row) =>
          row.event_type === 'enterprise.profile.configured'
          && row.correlation_id === 'profile-config-correlation',
      ),
    );
  } finally {
    c.release();
    await p.end();
  }
});
