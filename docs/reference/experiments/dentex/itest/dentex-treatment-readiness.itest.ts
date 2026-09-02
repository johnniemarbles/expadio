import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { loadDentexTreatmentReadiness } from '../lib/dentex-treatment-readiness';
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

test('DENTEX readiness renders executable Pack semantics and participant gates', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const organizationId = randomUUID();
    const actor = `${tenantId.slice(0, 8)}-dentist`;

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'DENTEX readiness tenant', 'dentex')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    await c.query(
      `INSERT INTO platform.organizations
         (organization_id, tenant_id, organization_kind, name, status)
       VALUES ($1::uuid, $2::uuid, 'BUSINESS', 'Readiness Dental Org', 'ACTIVE')`,
      [organizationId, tenantId],
    );

    const practiceId = (await c.query(
      `INSERT INTO platform.crm_accounts
         (tenant_id, organization_id, name, industry, lifecycle_stage)
       VALUES ($1::uuid, $2::uuid, 'Readiness Dental', 'Dental', 'CUSTOMER')
       RETURNING account_id`,
      [tenantId, organizationId],
    )).rows[0].account_id as string;

    const patientId = (await c.query(
      `INSERT INTO platform.crm_contacts
         (tenant_id, account_id, full_name, email, title)
       VALUES ($1::uuid, $2::uuid, 'Readiness Patient', 'readiness@example.test', 'Patient')
       RETURNING contact_id`,
      [tenantId, practiceId],
    )).rows[0].contact_id as string;

    const treatmentId = (await c.query(
      `INSERT INTO platform.crm_cases (
         tenant_id, account_id, contact_id, subject, priority, status,
         blueprint_key, owner_subject_id, attributes, attributes_schema_version,
         industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, 'Readiness Treatment', 'NORMAL', 'OPEN',
         'crm.case', $4, '{"urgency":"Routine"}'::jsonb, 1,
         'dentex', NULL, 'CODE_BASELINE'
       )
       RETURNING case_id`,
      [tenantId, practiceId, patientId, actor],
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

    await c.query(
      `UPDATE platform.crm_cases
          SET workflow_instance_id = $2::uuid,
              stage_key = $3,
              updated_at = now()
        WHERE case_id = $1::uuid`,
      [treatmentId, started.instance.instanceId, started.instance.currentStageKey],
    );

    const intake = await loadDentexTreatmentReadiness(c, { tenantId, treatmentId });
    assert.ok(intake);
    assert.equal(intake.currentStage, 'INTAKE');
    assert.equal(intake.nextStage, 'IN_PROGRESS');
    assert.equal(intake.canAdvance, true);
    assert.deepEqual(
      intake.requirements.map((item) => [item.key, item.satisfied]),
      [
        ['relationship:crm.contact', true],
        ['relationship:crm.account', true],
      ],
    );

    const inProgress = await transitionWorkflow(c, {
      tenantId,
      instanceId: started.instance.instanceId,
      expectedRevision: started.instance.revision,
      toStageKey: 'IN_PROGRESS',
      requestedBySubjectId: actor,
    });
    assert.ok(inProgress.ok);

    await c.query(
      `UPDATE platform.crm_cases SET stage_key = 'IN_PROGRESS', updated_at = now()
        WHERE case_id = $1::uuid`,
      [treatmentId],
    );

    const blocked = await loadDentexTreatmentReadiness(c, { tenantId, treatmentId });
    assert.ok(blocked);
    assert.equal(blocked.currentStage, 'IN_PROGRESS');
    assert.equal(blocked.nextStage, 'REVIEW');
    assert.equal(blocked.canAdvance, false);
    assert.equal(
      blocked.requirements.find((item) => item.key === 'attribute:procedureCode')?.satisfied,
      false,
    );
    assert.equal(
      blocked.requirements.find((item) => item.key === 'participant:REVIEW:reviewer')?.satisfied,
      false,
    );

    await c.query(
      `UPDATE platform.crm_cases
          SET attributes = attributes || '{"procedureCode":"D3310"}'::jsonb,
              updated_at = now()
        WHERE case_id = $1::uuid`,
      [treatmentId],
    );

    await assignParticipant(c, {
      tenantId,
      instanceId: started.instance.instanceId,
      stageKey: 'REVIEW',
      participantKey: 'reviewer',
      targetKind: 'USER',
      targetKey: actor,
      assignedBySubjectId: actor,
    });

    const ready = await loadDentexTreatmentReadiness(c, { tenantId, treatmentId });
    assert.ok(ready);
    assert.equal(ready.canAdvance, true);
    assert.equal(
      ready.requirements.find((item) => item.key === 'attribute:procedureCode')?.satisfied,
      true,
    );
    assert.equal(
      ready.requirements.find((item) => item.key === 'participant:REVIEW:reviewer')?.satisfied,
      true,
    );
  } finally {
    c.release();
    await p.end();
  }
});
