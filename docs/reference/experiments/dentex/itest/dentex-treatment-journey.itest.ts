import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { startWorkflow, transitionWorkflow } from '../lib/workflow-runtime';
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

test('DENTEX Treatment crosses real Consultation and procedure semantic gates', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const organizationId = randomUUID();
    const mover = `${tenantId.slice(0, 8)}-dentist`;

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'DENTEX journey tenant', 'dentex')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    await c.query(
      `INSERT INTO platform.organizations (organization_id, tenant_id, organization_kind, name, status)
       VALUES ($1::uuid, $2::uuid, 'BUSINESS', 'DENTEX Practice Org', 'ACTIVE')`,
      [organizationId, tenantId],
    );

    const practiceId = (await c.query(
      `INSERT INTO platform.crm_accounts
         (tenant_id, organization_id, name, industry, lifecycle_stage)
       VALUES ($1::uuid, $2::uuid, 'Downtown Dental', 'Dental', 'CUSTOMER')
       RETURNING account_id`,
      [tenantId, organizationId],
    )).rows[0].account_id as string;

    const patientId = (await c.query(
      `INSERT INTO platform.crm_contacts
         (tenant_id, account_id, full_name, email, title)
       VALUES ($1::uuid, $2::uuid, 'Asha Patient', 'asha@example.test', 'Patient')
       RETURNING contact_id`,
      [tenantId, practiceId],
    )).rows[0].contact_id as string;

    // Deliberately omit account_id first: the DENTEX Consultation exit must
    // refuse to begin treatment until the Practice is linked to the Treatment.
    const treatmentId = (await c.query(
      `INSERT INTO platform.crm_cases (
         tenant_id, contact_id, subject, priority, status, blueprint_key,
         attributes, attributes_schema_version,
         industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source
       ) VALUES (
         $1::uuid, $2::uuid, 'Root canal — UR6', 'NORMAL', 'OPEN', 'crm.case',
         '{"urgency":"Priority","tooth":"UR6"}'::jsonb, 1,
         'dentex', NULL, 'CODE_BASELINE'
       )
       RETURNING case_id`,
      [tenantId, patientId],
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
    assert.equal(started.instance.currentStageKey, 'INTAKE');

    const missingPractice = await transitionWorkflow(c, {
      tenantId,
      instanceId: started.instance.instanceId,
      expectedRevision: started.instance.revision,
      toStageKey: 'IN_PROGRESS',
      requestedBySubjectId: mover,
    });
    assert.ok(missingPractice.ok === false && missingPractice.reason === 'GATE_BLOCKED');
    if (missingPractice.ok || missingPractice.reason !== 'GATE_BLOCKED') {
      throw new Error('DENTEX Consultation unexpectedly ignored missing Practice');
    }
    assert.ok(
      missingPractice.blockers.some(
        (item) =>
          item.code === 'CASE_SEMANTIC_RELATIONSHIP_REQUIRED'
          && item.key === 'crm.account',
      ),
    );

    await c.query(
      `UPDATE platform.crm_cases
          SET account_id = $3::uuid
        WHERE tenant_id = $1::uuid
          AND case_id = $2::uuid`,
      [tenantId, treatmentId, practiceId],
    );

    const treatmentStarted = await transitionWorkflow(c, {
      tenantId,
      instanceId: started.instance.instanceId,
      expectedRevision: started.instance.revision,
      toStageKey: 'IN_PROGRESS',
      requestedBySubjectId: mover,
    });
    assert.ok(treatmentStarted.ok);
    assert.equal(treatmentStarted.instance.currentStageKey, 'IN_PROGRESS');

    await assignParticipant(c, {
      tenantId,
      instanceId: started.instance.instanceId,
      stageKey: 'REVIEW',
      participantKey: 'reviewer',
      targetKind: 'USER',
      targetKey: mover,
      assignedBySubjectId: mover,
    });

    const missingProcedure = await transitionWorkflow(c, {
      tenantId,
      instanceId: started.instance.instanceId,
      expectedRevision: treatmentStarted.instance.revision,
      toStageKey: 'REVIEW',
      requestedBySubjectId: mover,
    });
    assert.ok(missingProcedure.ok === false && missingProcedure.reason === 'GATE_BLOCKED');
    if (missingProcedure.ok || missingProcedure.reason !== 'GATE_BLOCKED') {
      throw new Error('DENTEX Treatment unexpectedly ignored missing procedure');
    }
    assert.ok(
      missingProcedure.blockers.some(
        (item) =>
          item.code === 'CASE_SEMANTIC_ATTRIBUTE_REQUIRED'
          && item.key === 'procedureCode',
      ),
    );

    await c.query(
      `UPDATE platform.crm_cases
          SET attributes = attributes || '{"procedureCode":"D3310"}'::jsonb
        WHERE tenant_id = $1::uuid
          AND case_id = $2::uuid`,
      [tenantId, treatmentId],
    );

    const review = await transitionWorkflow(c, {
      tenantId,
      instanceId: started.instance.instanceId,
      expectedRevision: treatmentStarted.instance.revision,
      toStageKey: 'REVIEW',
      requestedBySubjectId: mover,
    });
    assert.ok(review.ok);
    assert.equal(review.instance.currentStageKey, 'REVIEW');

    const persisted = (await c.query(
      `SELECT current_stage_key, state,
              industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source
         FROM platform.workflow_instances
        WHERE tenant_id = $1::uuid
          AND instance_id = $2::uuid`,
      [tenantId, started.instance.instanceId],
    )).rows[0];

    assert.deepEqual(persisted, {
      current_stage_key: 'REVIEW',
      state: 'RUNNING',
      industry_pack_vertical_key: 'dentex',
      industry_pack_version: null,
      industry_pack_runtime_source: 'CODE_BASELINE',
    });
  } finally {
    c.release();
    await p.end();
  }
});
