import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  approveCreateOrganizationRequest,
  requestChildOrganization,
} from '@expadio/postgres-runtime/enterprise';

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

test('enterprise hierarchy request -> approval -> provisioning is durable and cycle-safe', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const rootOrganizationId = randomUUID();
    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, status)
       VALUES ($1::uuid, 'Enterprise hierarchy integration', 'ACTIVE')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    await c.query(
      `INSERT INTO platform.organizations (
         organization_id, tenant_id, organization_kind, name, status
       ) VALUES ($1::uuid, $2::uuid, 'GLOBAL_HQ', 'Global HQ', 'ACTIVE')`,
      [rootOrganizationId, tenantId],
    );

    const enterprise = await c.query<{ enterprise_id: string }>(
      `SELECT enterprise_id
         FROM platform.organizations
        WHERE tenant_id = $1::uuid AND organization_id = $2::uuid`,
      [tenantId, rootOrganizationId],
    );
    const enterpriseId = enterprise.rows[0]?.enterprise_id;
    assert.ok(enterpriseId);

    await c.query(
      `INSERT INTO platform.memberships (
         tenant_id, organization_id, subject_id, actor_kind, issuer, status,
         workspace_scope_mode, operating_unit_scope_mode, organization_scope_mode
       ) VALUES (
         $1::uuid, $2::uuid, 'enterprise-parent-admin', 'user',
         'https://clerk.expadio.com', 'ACTIVE', 'ALL', 'ALL', 'SELF_AND_DESCENDANTS'
       )`,
      [tenantId, rootOrganizationId],
    );

    await c.query('BEGIN');
    const submitted = await requestChildOrganization(c, {
      tenantId,
      enterpriseId,
      parentOrganizationId: rootOrganizationId,
      name: 'Canada Operations',
      organizationKind: 'COUNTRY',
      requestedBySubjectId: 'enterprise-requester',
      correlationId: randomUUID(),
      idempotencyKey: 'enterprise-canada-create',
    });
    await c.query('COMMIT');

    assert.equal(submitted.idempotent, false);
    assert.equal(submitted.request.status, 'SUBMITTED');
    assert.equal(submitted.request.enterpriseId, enterpriseId);

    await c.query('BEGIN');
    const replay = await requestChildOrganization(c, {
      tenantId,
      enterpriseId,
      parentOrganizationId: rootOrganizationId,
      name: 'Canada Operations',
      organizationKind: 'COUNTRY',
      requestedBySubjectId: 'enterprise-requester',
      correlationId: randomUUID(),
      idempotencyKey: 'enterprise-canada-create',
    });
    await c.query('COMMIT');
    assert.equal(replay.idempotent, true);
    assert.equal(replay.request.requestId, submitted.request.requestId);

    await c.query('BEGIN');
    await assert.rejects(
      () => requestChildOrganization(c, {
        tenantId,
        enterpriseId,
        parentOrganizationId: rootOrganizationId,
        name: 'Different Canada Organization',
        organizationKind: 'COUNTRY',
        requestedBySubjectId: 'enterprise-requester',
        correlationId: randomUUID(),
        idempotencyKey: 'enterprise-canada-create',
      }),
      /ENTERPRISE_IDEMPOTENCY_KEY_CONFLICT/,
    );
    await c.query('ROLLBACK');

    await c.query('BEGIN');
    await assert.rejects(
      () => approveCreateOrganizationRequest(c, {
        tenantId,
        requestId: submitted.request.requestId,
        approverOrganizationId: rootOrganizationId,
        decidedBySubjectId: 'enterprise-requester',
      }),
      /ENTERPRISE_SEPARATION_OF_DUTIES_REQUIRED/,
    );
    await c.query('ROLLBACK');

    await c.query('BEGIN');
    const approved = await approveCreateOrganizationRequest(c, {
      tenantId,
      requestId: submitted.request.requestId,
      approverOrganizationId: rootOrganizationId,
      decidedBySubjectId: 'enterprise-approver',
      decidedByIssuer: 'https://clerk.expadio.com',
      decisionReason: 'Country structure approved',
    });
    await c.query('COMMIT');

    assert.equal(approved.request.status, 'APPROVED');

    const child = await c.query(
      `SELECT parent_organization_id, enterprise_id, status
         FROM platform.organizations
        WHERE tenant_id = $1::uuid AND organization_id = $2::uuid`,
      [tenantId, approved.organizationId],
    );
    assert.deepEqual(child.rows[0], {
      parent_organization_id: rootOrganizationId,
      enterprise_id: enterpriseId,
      status: 'CONFIGURING',
    });

    const closure = await c.query(
      `SELECT depth
         FROM platform.organization_closure
        WHERE tenant_id = $1::uuid
          AND ancestor_organization_id = $2::uuid
          AND descendant_organization_id = $3::uuid`,
      [tenantId, rootOrganizationId, approved.organizationId],
    );
    assert.equal(closure.rows[0]?.depth, 1);

    await assert.rejects(
      () => c.query(
        `UPDATE platform.organizations
            SET parent_organization_id = $2::uuid
          WHERE tenant_id = $1::uuid
            AND organization_id = $3::uuid`,
        [tenantId, approved.organizationId, rootOrganizationId],
      ),
      /organization hierarchy cycle rejected/,
    );

    await assert.rejects(
      () => c.query(
        `UPDATE platform.organizations
            SET status = 'ACTIVE'
          WHERE tenant_id = $1::uuid
            AND organization_id = $2::uuid`,
        [tenantId, approved.organizationId],
      ),
      /organization activation requires activated setup plan/,
    );

    const expanded = await c.query(
      `SELECT organization_id
         FROM platform.active_memberships_for_subject(
           'enterprise-parent-admin',
           'https://clerk.expadio.com'
         )
        WHERE tenant_id = $1::uuid
        ORDER BY organization_id`,
      [tenantId],
    );
    assert.deepEqual(
      expanded.rows.map((row) => row.organization_id),
      [rootOrganizationId],
    );

    const setup = await c.query(
      `SELECT state, total_requirements, completed_requirements, blocking_open_requirements
         FROM platform.organization_setup_plans
        WHERE tenant_id = $1::uuid
          AND organization_id = $2::uuid`,
      [tenantId, approved.organizationId],
    );
    assert.deepEqual(setup.rows[0], {
      state: 'CONFIGURING',
      total_requirements: 3,
      completed_requirements: 2,
      blocking_open_requirements: 1,
    });

    const events = await c.query(
      `SELECT event_type
         FROM platform.domain_events
        WHERE tenant_id = $1::uuid
          AND correlation_id = $2
        ORDER BY event_type`,
      [tenantId, submitted.request.correlationId],
    );
    const eventTypes = events.rows.map((row) => row.event_type);
    assert.ok(eventTypes.includes('enterprise.change_request.approved'));
    assert.ok(eventTypes.includes('enterprise.change_request.submitted'));
    assert.ok(eventTypes.includes('organization.provisioned'));
    assert.ok(eventTypes.includes('organization.setup.started'));
    assert.equal(
      eventTypes.filter((eventType) => eventType === 'organization.setup.requirement_added').length,
      3,
    );
  } finally {
    c.release();
    await p.end();
  }
});

test('legal registration identity is tenant-local and duplicate-safe', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, status)
       VALUES ($1::uuid, 'Legal identity integration', 'ACTIVE')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    const enterprise = await c.query<{ enterprise_id: string }>(
      `SELECT enterprise_id
         FROM platform.enterprise_profiles
        WHERE tenant_id = $1::uuid
        ORDER BY created_at
        LIMIT 1`,
      [tenantId],
    );
    const enterpriseId = enterprise.rows[0]?.enterprise_id;
    assert.ok(enterpriseId);

    const first = randomUUID();
    const second = randomUUID();
    for (const [id, name] of [[first, 'Canada OpCo Inc.'], [second, 'Duplicate Canada OpCo Inc.']]) {
      await c.query(
        `INSERT INTO platform.legal_entities (
           legal_entity_id, tenant_id, enterprise_id, legal_name, entity_type,
           jurisdiction_country_code, status, created_by_subject_id
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'CORPORATION', 'CA', 'DRAFT', 'itest')`,
        [id, tenantId, enterpriseId, name],
      );
    }

    await c.query(
      `INSERT INTO platform.legal_entity_registration_identifiers (
         tenant_id, legal_entity_id, jurisdiction_code, identifier_type,
         identifier_value, normalized_identifier, verification_status,
         created_by_subject_id
       ) VALUES (
         $1::uuid, $2::uuid, 'CA', 'CORPORATION_NUMBER',
         'BC 123-456', 'BC123456', 'VERIFIED', 'itest'
       )`,
      [tenantId, first],
    );

    await assert.rejects(
      () => c.query(
        `INSERT INTO platform.legal_entity_registration_identifiers (
           tenant_id, legal_entity_id, jurisdiction_code, identifier_type,
           identifier_value, normalized_identifier, verification_status,
           created_by_subject_id
         ) VALUES (
           $1::uuid, $2::uuid, 'ca', 'corporation_number',
           'BC123456', 'BC123456', 'PENDING', 'itest'
         )`,
        [tenantId, second],
      ),
      /duplicate key value/,
    );
  } finally {
    c.release();
    await p.end();
  }
});
