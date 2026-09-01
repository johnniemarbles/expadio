import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  approveCreateOrganizationRequest,
  requestChildOrganization,
} from '@expadio/postgres-runtime/enterprise';
import { hasGovernanceWriteRoleForOrganization } from '../lib/governance-authz';
import {
  activateOrganizationSetup,
  addOrganizationSetupDependency,
  assignOrganizationOperatingEntity,
  changeOrganizationSetupRequirement,
  designateOrganizationSetupPrimaryAdministrator,
  listOrganizationSetupRequirements,
  registerOrganizationSetupRequirement,
} from '@expadio/postgres-runtime/enterprise-onboarding';

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

test('approved child is configured through governed readiness before activation', async () => {
  const p = pool();
  const c = await p.connect();
  const roleName = `expadio_setup_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  try {
    const tenantId = randomUUID();
    const rootOrganizationId = randomUUID();
    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, status)
       VALUES ($1::uuid, 'Enterprise setup integration', 'ACTIVE')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    await c.query(
      `INSERT INTO platform.organizations (
         organization_id, tenant_id, organization_kind, name, status
       ) VALUES ($1::uuid, $2::uuid, 'GLOBAL_HQ', 'Global HQ', 'ACTIVE')`,
      [rootOrganizationId, tenantId],
    );

    const enterpriseId = (
      await c.query<{ enterprise_id: string }>(
        `SELECT enterprise_id
           FROM platform.organizations
          WHERE tenant_id = $1::uuid AND organization_id = $2::uuid`,
        [tenantId, rootOrganizationId],
      )
    ).rows[0]?.enterprise_id;
    assert.ok(enterpriseId);

    await c.query(
      `INSERT INTO platform.memberships (
         tenant_id, organization_id, subject_id, actor_kind, issuer, status,
         workspace_scope_mode, operating_unit_scope_mode, organization_scope_mode
       ) VALUES (
         $1::uuid, $2::uuid, 'parent-admin', 'user',
         'https://clerk.expadio.com', 'ACTIVE', 'ALL', 'ALL',
         'SELF_AND_DESCENDANTS'
       )`,
      [tenantId, rootOrganizationId],
    );

    const siblingOrganizationId = randomUUID();
    await c.query(
      `INSERT INTO platform.organizations (
         organization_id, tenant_id, enterprise_id, parent_organization_id,
         organization_kind, name, status
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid,
         'REGION', 'Sibling Region', 'ACTIVE'
       )`,
      [siblingOrganizationId, tenantId, enterpriseId, rootOrganizationId],
    );
    const tenantAdminRoleId = (
      await c.query<{ role_id: string }>(
        `INSERT INTO platform.authorization_roles (
           role_key, display_name, ownership_scope, tenant_id, status
         ) VALUES (
           'TENANT_ADMIN', 'Enterprise scoped admin', 'TENANT', $1::uuid, 'ACTIVE'
         )
         RETURNING role_id`,
        [tenantId],
      )
    ).rows[0]!.role_id;
    await c.query(
      `INSERT INTO platform.authorization_assignments (
         tenant_id, organization_id, subject_id, role_id, status
       ) VALUES (
         $1::uuid, $2::uuid, 'sibling-admin', $3::uuid, 'ACTIVE'
       )`,
      [tenantId, siblingOrganizationId, tenantAdminRoleId],
    );
    assert.equal(
      await hasGovernanceWriteRoleForOrganization(
        c,
        'sibling-admin',
        siblingOrganizationId,
      ),
      true,
    );
    assert.equal(
      await hasGovernanceWriteRoleForOrganization(
        c,
        'sibling-admin',
        rootOrganizationId,
      ),
      false,
    );

    await c.query('BEGIN');
    const requested = await requestChildOrganization(c, {
      tenantId,
      enterpriseId,
      parentOrganizationId: rootOrganizationId,
      name: 'Canada Operations',
      organizationKind: 'COUNTRY',
      requestedBySubjectId: 'requester',
      correlationId: randomUUID(),
      idempotencyKey: 'setup-itest-create-canada',
    });
    const approved = await approveCreateOrganizationRequest(c, {
      tenantId,
      requestId: requested.request.requestId,
      approverOrganizationId: rootOrganizationId,
      decidedBySubjectId: 'setup-owner',
      decidedByIssuer: 'https://clerk.expadio.com',
      decisionReason: 'Approved for controlled setup.',
    });
    await c.query('COMMIT');

    assert.ok(approved.setupPlanId);

    const child = await c.query<{
      status: string;
      parent_organization_id: string;
      enterprise_id: string;
    }>(
      `SELECT status, parent_organization_id, enterprise_id
         FROM platform.organizations
        WHERE tenant_id = $1::uuid
          AND organization_id = $2::uuid`,
      [tenantId, approved.organizationId],
    );
    assert.deepEqual(child.rows[0], {
      status: 'CONFIGURING',
      parent_organization_id: rootOrganizationId,
      enterprise_id: enterpriseId,
    });

    let plan = (
      await c.query<{
        state: string;
        total_requirements: number;
        completed_requirements: number;
        blocking_open_requirements: number;
        completion_percent: string;
      }>(
        `SELECT state, total_requirements, completed_requirements,
                blocking_open_requirements, completion_percent
           FROM platform.organization_setup_plans
          WHERE tenant_id = $1::uuid
            AND setup_plan_id = $2::uuid`,
        [tenantId, approved.setupPlanId],
      )
    ).rows[0];
    assert.equal(plan?.state, 'CONFIGURING');
    assert.equal(Number(plan?.total_requirements), 3);
    assert.equal(Number(plan?.completed_requirements), 1);
    assert.equal(Number(plan?.blocking_open_requirements), 2);
    assert.equal(Number(plan?.completion_percent), 33.33);

    const participant = await c.query(
      `SELECT subject_id, role, status
         FROM platform.organization_setup_participants
        WHERE tenant_id = $1::uuid
          AND setup_plan_id = $2::uuid`,
      [tenantId, approved.setupPlanId],
    );
    assert.deepEqual(participant.rows[0], {
      subject_id: 'setup-owner',
      role: 'OWNER',
      status: 'ACTIVE',
    });

    await c.query('BEGIN');
    const designated = await designateOrganizationSetupPrimaryAdministrator(c, {
      tenantId,
      setupPlanId: approved.setupPlanId!,
      subjectId: 'setup-owner',
      issuer: 'https://clerk.expadio.com',
      actorSubjectId: 'setup-owner',
      correlationId: 'setup-primary-admin',
      idempotencyKey: 'setup-primary-admin-owner',
    });
    await c.query('COMMIT');
    assert.equal(designated.plan.primaryAdministratorSubjectId, 'setup-owner');
    assert.equal(designated.plan.completedRequirements, 2);
    assert.equal(designated.plan.blockingOpenRequirements, 1);

    // Non-owner role: pre-activation discovery works only for the assigned subject.
    await c.query(`CREATE ROLE ${roleName} NOLOGIN`);
    await c.query(`GRANT USAGE ON SCHEMA platform TO ${roleName}`);
    await c.query(
      `GRANT SELECT ON platform.organization_setup_plans,
                       platform.organization_setup_participants
        TO ${roleName}`,
    );
    await c.query(`SET ROLE ${roleName}`);
    await c.query(`SELECT set_config('app.tenant_id', '', false)`);
    await c.query(`SELECT set_config('app.subject_id', 'other-user', false)`);
    await c.query(`SELECT set_config('app.issuer', 'https://clerk.expadio.com', false)`);
    const wrongSubject = await c.query(
      `SELECT count(*)::int AS count FROM platform.organization_setup_plans`,
    );
    assert.equal(wrongSubject.rows[0]?.count, 0);

    await c.query(`SELECT set_config('app.subject_id', 'setup-owner', false)`);
    const ownSubject = await c.query(
      `SELECT setup_plan_id FROM platform.organization_setup_plans`,
    );
    assert.deepEqual(ownSubject.rows.map((row) => row.setup_plan_id), [approved.setupPlanId]);
    await c.query('RESET ROLE');

    const core = await listOrganizationSetupRequirements(c, {
      tenantId,
      setupPlanId: approved.setupPlanId!,
    });
    const byKey = new Map(core.map((requirement) => [requirement.requirementKey, requirement]));
    assert.equal(byKey.get('core.organization-profile')?.satisfactionMode, 'AUTOMATED');
    assert.equal(byKey.get('core.organization-profile')?.status, 'SATISFIED');
    assert.equal(byKey.get('core.operating-entity')?.satisfactionMode, 'AUTOMATED');
    assert.equal(byKey.get('core.operating-entity')?.status, 'PENDING');
    assert.equal(byKey.get('core.primary-administrator')?.status, 'SATISFIED');
    assert.ok(
      byKey.get('core.primary-administrator')?.evidenceRefs.includes(
        'subject:setup-owner',
      ),
    );

    await c.query('BEGIN');
    await assert.rejects(
      () => changeOrganizationSetupRequirement(c, {
        tenantId,
        setupPlanId: approved.setupPlanId!,
        requirementId: byKey.get('core.operating-entity')!.setupRequirementId,
        action: 'SATISFY',
        actorSubjectId: 'setup-owner',
        evidenceRefs: ['manual:claim'],
        correlationId: 'setup-progress',
        idempotencyKey: 'manual-operating-entity-bypass',
      }),
      /ORGANIZATION_SETUP_AUTOMATED_REQUIREMENT/,
    );
    await c.query('ROLLBACK');

    await c.query('BEGIN');
    const policyA = await registerOrganizationSetupRequirement(c, {
      tenantId,
      setupPlanId: approved.setupPlanId!,
      requirementKey: 'parent-policy.country-go-live',
      category: 'GOVERNANCE',
      sourceKind: 'PARENT_POLICY',
      sourceKey: 'global-hq-country-policy',
      title: 'Complete country go-live review',
      description: 'Parent policy readiness gate.',
      blocking: true,
      sortOrder: 40,
      createdBySubjectId: 'setup-owner',
      correlationId: 'setup-policy-correlation',
      idempotencyKey: 'setup-policy-country-go-live',
    });
    const policyB = await registerOrganizationSetupRequirement(c, {
      tenantId,
      setupPlanId: approved.setupPlanId!,
      requirementKey: 'tenant.country-controls',
      category: 'COMPLIANCE',
      sourceKind: 'TENANT',
      sourceKey: 'tenant-country-controls',
      title: 'Complete tenant country controls',
      description: 'Tenant-specific country control gate.',
      blocking: true,
      sortOrder: 50,
      createdBySubjectId: 'setup-owner',
      correlationId: 'setup-policy-correlation',
      idempotencyKey: 'setup-tenant-country-controls',
    });
    const optional = await registerOrganizationSetupRequirement(c, {
      tenantId,
      setupPlanId: approved.setupPlanId!,
      requirementKey: 'tenant.optional-training',
      category: 'CUSTOM',
      sourceKind: 'TENANT',
      sourceKey: 'optional-training',
      title: 'Optional launch training',
      description: 'Non-blocking launch recommendation.',
      blocking: false,
      sortOrder: 60,
      createdBySubjectId: 'setup-owner',
      correlationId: 'setup-policy-correlation',
      idempotencyKey: 'setup-optional-training',
    });
    assert.equal(optional.requirement.blocking, false);

    await addOrganizationSetupDependency(c, {
      tenantId,
      setupPlanId: approved.setupPlanId!,
      requirementId: policyB.requirement.setupRequirementId,
      dependsOnRequirementId: policyA.requirement.setupRequirementId,
      actorSubjectId: 'setup-owner',
      correlationId: 'setup-dependency',
      idempotencyKey: 'setup-dependency-b-on-a',
    });
    await c.query('COMMIT');

    await c.query('BEGIN');
    await assert.rejects(
      () => addOrganizationSetupDependency(c, {
        tenantId,
        setupPlanId: approved.setupPlanId!,
        requirementId: policyA.requirement.setupRequirementId,
        dependsOnRequirementId: policyB.requirement.setupRequirementId,
        actorSubjectId: 'setup-owner',
        correlationId: 'setup-dependency',
        idempotencyKey: 'setup-dependency-a-on-b-cycle',
      }),
      /organization setup dependency cycle rejected/,
    );
    await c.query('ROLLBACK');

    await c.query('BEGIN');
    await assert.rejects(
      () => changeOrganizationSetupRequirement(c, {
        tenantId,
        setupPlanId: approved.setupPlanId!,
        requirementId: policyB.requirement.setupRequirementId,
        action: 'SATISFY',
        actorSubjectId: 'setup-owner',
        correlationId: 'setup-progress',
        idempotencyKey: 'setup-progress-policy-b-too-early',
      }),
      /ORGANIZATION_SETUP_DEPENDENCIES_INCOMPLETE/,
    );
    await c.query('ROLLBACK');

    const legalEntityId = randomUUID();
    await c.query(
      `INSERT INTO platform.legal_entities (
         legal_entity_id, tenant_id, enterprise_id, legal_name, entity_type,
         jurisdiction_country_code, status, verified_at, created_by_subject_id
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, 'Canada Operating Company Inc.',
         'CORPORATION', 'CA', 'VERIFIED', now(), 'enterprise-test'
       )`,
      [legalEntityId, tenantId, enterpriseId],
    );

    await c.query('BEGIN');
    const operatingEntity = await assignOrganizationOperatingEntity(c, {
      tenantId,
      setupPlanId: approved.setupPlanId!,
      legalEntityId,
      actorSubjectId: 'setup-owner',
      correlationId: 'setup-operating-entity',
      idempotencyKey: 'setup-operating-entity-canada',
    });
    await c.query('COMMIT');
    assert.equal(operatingEntity.binding.legalEntityId, legalEntityId);
    assert.equal(operatingEntity.plan.completedRequirements, 3);
    assert.equal(operatingEntity.plan.blockingOpenRequirements, 2);

    const blockingRequirements = [
      policyA.requirement,
      policyB.requirement,
    ];
    for (const requirement of blockingRequirements) {
      await c.query('BEGIN');
      await changeOrganizationSetupRequirement(c, {
        tenantId,
        setupPlanId: approved.setupPlanId!,
        requirementId: requirement.setupRequirementId,
        action: 'SATISFY',
        actorSubjectId: 'setup-owner',
        evidenceRefs: [`evidence:${requirement.requirementKey}`],
        correlationId: 'setup-progress',
        idempotencyKey: `setup-satisfy:${requirement.requirementKey}`,
      });
      await c.query('COMMIT');
    }

    plan = (
      await c.query(
        `SELECT state, total_requirements, completed_requirements,
                blocking_open_requirements, completion_percent
           FROM platform.organization_setup_plans
          WHERE tenant_id = $1::uuid
            AND setup_plan_id = $2::uuid`,
        [tenantId, approved.setupPlanId],
      )
    ).rows[0];
    assert.equal(plan.state, 'READY_FOR_ACTIVATION');
    assert.equal(Number(plan.total_requirements), 6);
    assert.equal(Number(plan.completed_requirements), 5);
    assert.equal(Number(plan.blocking_open_requirements), 0);
    assert.equal(Number(plan.completion_percent), 83.33);

    const readyChild = await c.query(
      `SELECT status FROM platform.organizations
        WHERE tenant_id = $1::uuid AND organization_id = $2::uuid`,
      [tenantId, approved.organizationId],
    );
    assert.equal(readyChild.rows[0]?.status, 'READY_FOR_ACTIVATION');

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

    await c.query('BEGIN');
    const activated = await activateOrganizationSetup(c, {
      tenantId,
      setupPlanId: approved.setupPlanId!,
      activatedBySubjectId: 'parent-admin',
      correlationId: 'setup-activation',
      idempotencyKey: 'setup-activate-canada',
      reason: 'All blocking readiness gates satisfied.',
    });
    await c.query('COMMIT');
    assert.equal(activated.plan.state, 'ACTIVATED');

    const activeChild = await c.query(
      `SELECT status FROM platform.organizations
        WHERE tenant_id = $1::uuid AND organization_id = $2::uuid`,
      [tenantId, approved.organizationId],
    );
    assert.equal(activeChild.rows[0]?.status, 'ACTIVE');

    const setupOwnerMembership = await c.query(
      `SELECT membership_id, status, organization_scope_mode
         FROM platform.memberships
        WHERE tenant_id = $1::uuid
          AND organization_id = $2::uuid
          AND subject_id = 'setup-owner'
          AND issuer IS NOT DISTINCT FROM 'https://clerk.expadio.com'
        LIMIT 1`,
      [tenantId, approved.organizationId],
    );
    assert.equal(setupOwnerMembership.rows[0]?.status, 'ACTIVE');
    assert.equal(setupOwnerMembership.rows[0]?.organization_scope_mode, 'SELF');

    const setupOwnerRoles = await c.query(
      `SELECT r.role_key
         FROM platform.authorization_assignments a
         JOIN platform.authorization_roles r ON r.role_id = a.role_id
        WHERE a.tenant_id = $1::uuid
          AND a.organization_id = $2::uuid
          AND a.subject_id = 'setup-owner'
          AND a.status = 'ACTIVE'
        ORDER BY r.role_key`,
      [tenantId, approved.organizationId],
    );
    assert.deepEqual(setupOwnerRoles.rows, []);

    const setupOwnerWorkspaces = await c.query(
      `SELECT organization_id
         FROM platform.active_memberships_for_subject(
           'setup-owner',
           'https://clerk.expadio.com'
         )
        WHERE tenant_id = $1::uuid`,
      [tenantId],
    );
    assert.deepEqual(
      setupOwnerWorkspaces.rows.map((row) => row.organization_id),
      [approved.organizationId],
    );

    const expanded = await c.query(
      `SELECT organization_id
         FROM platform.active_memberships_for_subject(
           'parent-admin',
           'https://clerk.expadio.com'
         )
        WHERE tenant_id = $1::uuid
        ORDER BY organization_id`,
      [tenantId],
    );
    assert.deepEqual(
      expanded.rows.map((row) => row.organization_id).sort(),
      [rootOrganizationId, siblingOrganizationId, approved.organizationId].sort(),
    );

    const setupAccessAfterActivation = await c.query(
      `SELECT *
         FROM platform.active_organization_setup_access_for_subject(
           'setup-owner',
           'https://clerk.expadio.com'
         )
        WHERE tenant_id = $1::uuid`,
      [tenantId],
    );
    assert.equal(setupAccessAfterActivation.rowCount, 0);

    const setupEvents = await c.query(
      `SELECT event_type
         FROM platform.organization_setup_events
        WHERE tenant_id = $1::uuid
          AND setup_plan_id = $2::uuid
        ORDER BY occurred_at, event_id`,
      [tenantId, approved.setupPlanId],
    );
    const setupEventTypes = setupEvents.rows.map((row) => row.event_type);
    assert.ok(setupEventTypes.includes('SETUP_STARTED'));
    assert.ok(setupEventTypes.includes('REQUIREMENT_ADDED'));
    assert.ok(setupEventTypes.includes('REQUIREMENT_STATUS_CHANGED'));
    assert.ok(setupEventTypes.includes('REQUIREMENT_DEPENDENCY_ADDED'));
    assert.ok(setupEventTypes.includes('OPERATING_ENTITY_ASSIGNED'));
    assert.ok(setupEventTypes.includes('PRIMARY_ADMINISTRATOR_DESIGNATED'));
    assert.ok(setupEventTypes.includes('SETUP_ACTIVATED'));

    await assert.rejects(
      () => c.query(
        `UPDATE platform.organization_setup_events
            SET reason = 'tampered'
          WHERE tenant_id = $1::uuid
            AND setup_plan_id = $2::uuid`,
        [tenantId, approved.setupPlanId],
      ),
      /organization setup events are append-only/,
    );

    const domainEvents = await c.query(
      `SELECT event_type
         FROM platform.domain_events
        WHERE tenant_id = $1::uuid
          AND aggregate_id IN ($2::uuid, $3::uuid, $4::uuid)
        ORDER BY event_type`,
      [
        tenantId,
        approved.setupPlanId,
        approved.organizationId,
        setupOwnerMembership.rows[0]!.membership_id,
      ],
    );
    const domainEventTypes = domainEvents.rows.map((row) => row.event_type);
    assert.ok(domainEventTypes.includes('organization.setup.started'));
    assert.ok(domainEventTypes.includes('organization.setup.requirement_added'));
    assert.ok(domainEventTypes.includes('organization.setup.requirement_changed'));
    assert.ok(domainEventTypes.includes('organization.setup.requirement_dependency_added'));
    assert.ok(domainEventTypes.includes('organization.setup.operating_entity_assigned'));
    assert.ok(domainEventTypes.includes('organization.setup.primary_administrator_designated'));
    assert.ok(domainEventTypes.includes('organization.setup.activated'));
    assert.ok(domainEventTypes.includes('organization.activated'));
    assert.ok(domainEventTypes.includes('tenant.membership.handed_off_from_setup'));
  } finally {
    try {
      await c.query('RESET ROLE');
      await c.query(`DROP ROLE IF EXISTS ${roleName}`);
    } catch {
      // Test cleanup must not obscure the primary assertion failure.
    }
    c.release();
    await p.end();
  }
});
