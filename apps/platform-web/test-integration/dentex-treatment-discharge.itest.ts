import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  makerForStage,
  recordCaseDecision,
  startWorkflow,
  transitionWorkflow,
} from '../lib/workflow-runtime';
import { assignParticipant } from '../lib/workflow-participants';

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

test('DENTEX Treatment requires Care plan + APPROVE before discharge', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const organizationId = randomUUID();
    const mover = `${tenantId.slice(0, 8)}-dentist`;
    const approver = `${tenantId.slice(0, 8)}-clinical-approver`;

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'DENTEX discharge tenant', 'dentex')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    await c.query(
      `INSERT INTO platform.organizations
         (organization_id, tenant_id, organization_kind, name, status)
       VALUES ($1::uuid, $2::uuid, 'BUSINESS', 'DENTEX Clinical Org', 'ACTIVE')`,
      [organizationId, tenantId],
    );

    const roleId = (await c.query(
      `INSERT INTO platform.authorization_roles
         (role_key, display_name, ownership_scope, tenant_id)
       VALUES ('TENANT_ADMIN', 'Clinical approver', 'TENANT', $1::uuid)
       RETURNING role_id`,
      [tenantId],
    )).rows[0].role_id as string;
    await c.query(
      `INSERT INTO platform.authorization_assignments
         (tenant_id, subject_id, role_id, status)
       VALUES ($1::uuid, $2, $3::uuid, 'ACTIVE')`,
      [tenantId, approver, roleId],
    );

    const practiceId = (await c.query(
      `INSERT INTO platform.crm_accounts
         (tenant_id, organization_id, name, industry, lifecycle_stage)
       VALUES ($1::uuid, $2::uuid, 'Harbour Dental', 'Dental', 'CUSTOMER')
       RETURNING account_id`,
      [tenantId, organizationId],
    )).rows[0].account_id as string;

    const patientId = (await c.query(
      `INSERT INTO platform.crm_contacts
         (tenant_id, account_id, full_name, email, title)
       VALUES ($1::uuid, $2::uuid, 'Mira Patient', 'mira@example.test', 'Patient')
       RETURNING contact_id`,
      [tenantId, practiceId],
    )).rows[0].contact_id as string;

    const treatmentId = (await c.query(
      `INSERT INTO platform.crm_cases (
         tenant_id, account_id, contact_id, subject, priority, status, blueprint_key,
         attributes, attributes_schema_version,
         industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, 'Crown — UL5', 'NORMAL', 'OPEN', 'crm.case',
         '{"urgency":"Routine","tooth":"UL5","procedureCode":"D2740"}'::jsonb, 1,
         'dentex', NULL, 'CODE_BASELINE'
       )
       RETURNING case_id`,
      [tenantId, practiceId, patientId],
    )).rows[0].case_id as string;

    const started = await startWorkflow(c, {
      tenantId,
      subjectType: 'crm.case',
      subjectId: treatmentId,
      blueprintKey: 'crm.case',
      industryPackProvenance: {
        runtimeSource: 'CODE_BASELINE',
        verticalKey: 'dentex',
      },
    });
    assert.ok(started.ok);

    await assignParticipant(c, {
      tenantId,
      instanceId: started.instance.instanceId,
      stageKey: 'REVIEW',
      participantKey: 'reviewer',
      targetKind: 'USER',
      targetKey: mover,
      assignedBySubjectId: mover,
    });

    const inProgress = await transitionWorkflow(c, {
      tenantId,
      instanceId: started.instance.instanceId,
      expectedRevision: started.instance.revision,
      toStageKey: 'IN_PROGRESS',
      requestedBySubjectId: mover,
    });
    assert.ok(inProgress.ok);

    const review = await transitionWorkflow(c, {
      tenantId,
      instanceId: started.instance.instanceId,
      expectedRevision: inProgress.instance.revision,
      toStageKey: 'REVIEW',
      requestedBySubjectId: mover,
    });
    assert.ok(review.ok);

    const blocked = await transitionWorkflow(c, {
      tenantId,
      instanceId: started.instance.instanceId,
      expectedRevision: review.instance.revision,
      toStageKey: 'RESOLVED',
      requestedBySubjectId: mover,
    });
    assert.ok(blocked.ok === false && blocked.reason === 'GATE_BLOCKED');
    if (blocked.ok || blocked.reason !== 'GATE_BLOCKED') {
      throw new Error('DENTEX Clinical Review unexpectedly discharged without evidence');
    }
    assert.ok(
      blocked.blockers.some(
        (item) =>
          item.code === 'CASE_SEMANTIC_RELATIONSHIP_REQUIRED'
          && item.key === 'crm.agreement',
      ),
    );
    assert.ok(
      blocked.blockers.some(
        (item) => item.code === 'CASE_SEMANTIC_DECISION_OUTCOME_REQUIRED',
      ),
    );

    // The active Agreement is the canonical CRM object that DENTEX names a
    // Care plan. A null monetary value keeps this test focused on clinical
    // decision authority rather than threshold/delegation policy.
    await c.query(
      `INSERT INTO platform.crm_agreements
         (tenant_id, account_id, title, status, value_minor_units, currency)
       VALUES ($1::uuid, $2::uuid, 'Crown care plan', 'ACTIVE', NULL, 'USD')`,
      [tenantId, practiceId],
    );

    const maker = await makerForStage(c, {
      tenantId,
      instanceId: started.instance.instanceId,
      stageKey: 'REVIEW',
    });
    assert.equal(maker, mover);

    const decision = await recordCaseDecision(c, {
      tenantId,
      instanceId: started.instance.instanceId,
      workTypeKey: 'crm.case',
      stageKey: 'REVIEW',
      outcome: 'APPROVE',
      approverSubjectId: approver,
      makerSubjectId: maker,
    });
    assert.ok(decision.ok);

    const discharged = await transitionWorkflow(c, {
      tenantId,
      instanceId: started.instance.instanceId,
      expectedRevision: review.instance.revision,
      toStageKey: 'RESOLVED',
      requestedBySubjectId: approver,
    });
    assert.ok(discharged.ok);
    assert.equal(discharged.instance.currentStageKey, 'RESOLVED');
    assert.equal(discharged.instance.state, 'COMPLETED');

    const persistedDecision = (await c.query(
      `SELECT outcome, decided_by_subject_id
         FROM platform.workflow_stage_decisions
        WHERE tenant_id = $1::uuid
          AND instance_id = $2::uuid
          AND stage_key = 'REVIEW'`,
      [tenantId, started.instance.instanceId],
    )).rows[0];
    assert.deepEqual(persistedDecision, {
      outcome: 'APPROVE',
      decided_by_subject_id: approver,
    });

    const persisted = (await c.query(
      `SELECT current_stage_key, state, completed_at IS NOT NULL AS completed,
              industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source
         FROM platform.workflow_instances
        WHERE tenant_id = $1::uuid
          AND instance_id = $2::uuid`,
      [tenantId, started.instance.instanceId],
    )).rows[0];

    assert.deepEqual(persisted, {
      current_stage_key: 'RESOLVED',
      state: 'COMPLETED',
      completed: true,
      industry_pack_vertical_key: 'dentex',
      industry_pack_version: null,
      industry_pack_runtime_source: 'CODE_BASELINE',
    });
  } finally {
    c.release();
    await p.end();
  }
});
