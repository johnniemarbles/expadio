import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { resolveTreatmentOwnerSubjectId } from '../lib/crm-owner-resolution';
import { startWorkflow } from '../lib/workflow-runtime';
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

test('DENTEX Lead conversion preserves Lead owner and projects it to workflow owner when converter differs', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const organizationId = randomUUID();
    const leadOwner = `${tenantId.slice(0, 8)}-lead-owner`;
    const converter = `${tenantId.slice(0, 8)}-converter`;
    assert.notEqual(leadOwner, converter);

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'DENTEX owner projection tenant', 'dentex')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    await c.query(
      `INSERT INTO platform.organizations
         (organization_id, tenant_id, organization_kind, name, status)
       VALUES ($1::uuid, $2::uuid, 'BUSINESS', 'DENTEX Owner Practice Org', 'ACTIVE')`,
      [organizationId, tenantId],
    );

    const accountId = (await c.query(
      `INSERT INTO platform.crm_accounts
         (tenant_id, organization_id, name, industry, lifecycle_stage)
       VALUES ($1::uuid, $2::uuid, 'Owner Dental', 'Dental', 'LEAD')
       RETURNING account_id`,
      [tenantId, organizationId],
    )).rows[0].account_id as string;

    const patientId = (await c.query(
      `INSERT INTO platform.crm_contacts
         (tenant_id, account_id, full_name, email, title)
       VALUES ($1::uuid, $2::uuid, 'Owner Projection Patient', 'owner-projection@example.test', 'Patient')
       RETURNING contact_id`,
      [tenantId, accountId],
    )).rows[0].contact_id as string;

    const leadId = (await c.query(
      `INSERT INTO platform.crm_leads
         (tenant_id, account_id, contact_id, title, stage, owner_subject_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Root canal lead', 'QUALIFIED', $4)
       RETURNING lead_id`,
      [tenantId, accountId, patientId, leadOwner],
    )).rows[0].lead_id as string;

    await c.query('BEGIN');
    try {
      const lead = (await c.query(
        `SELECT lead_id, account_id, contact_id, owner_subject_id
           FROM platform.crm_leads
          WHERE lead_id = $1::uuid
          FOR UPDATE`,
        [leadId],
      )).rows[0];

      const treatmentOwnerSubjectId = resolveTreatmentOwnerSubjectId({
        explicitOwnerSubjectId: null,
        leadOwnerSubjectId: lead.owner_subject_id,
        conversionActorSubjectId: converter,
      });
      assert.equal(treatmentOwnerSubjectId, leadOwner);
      assert.notEqual(treatmentOwnerSubjectId, converter);

      await c.query(
        `UPDATE platform.crm_accounts
            SET lifecycle_stage = 'CUSTOMER', updated_at = now()
          WHERE account_id = $1::uuid`,
        [accountId],
      );
      await c.query(
        `UPDATE platform.crm_leads
            SET stage = 'WON', updated_at = now()
          WHERE lead_id = $1::uuid`,
        [leadId],
      );

      const treatment = (await c.query(
        `INSERT INTO platform.crm_cases (
           tenant_id, account_id, contact_id, subject, priority, status,
           blueprint_key, owner_subject_id, attributes, attributes_schema_version,
           industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, 'Root canal — UR6', 'NORMAL', 'OPEN',
           'crm.case', $4, '{"urgency":"Priority","tooth":"UR6"}'::jsonb, 1,
           'dentex', NULL, 'CODE_BASELINE'
         )
         RETURNING case_id, owner_subject_id`,
        [tenantId, accountId, patientId, treatmentOwnerSubjectId],
      )).rows[0];

      const started = await startWorkflow(c, {
        tenantId,
        subjectType: 'crm.case',
        subjectId: treatment.case_id,
        blueprintKey: 'crm.case',
        industryPackProvenance: {
          runtimeSource: 'CODE_BASELINE',
          verticalKey: 'dentex',
        },
      });
      assert.ok(started.ok);
      assert.equal(started.instance.currentStageKey, 'INTAKE');

      await assignParticipant(c, {
        tenantId,
        instanceId: started.instance.instanceId,
        stageKey: started.instance.currentStageKey,
        participantKey: 'owner',
        targetKind: 'USER',
        targetKey: treatment.owner_subject_id,
        assignedBySubjectId: converter,
      });

      await c.query(
        `UPDATE platform.crm_cases
            SET workflow_instance_id = $2::uuid,
                stage_key = $3,
                updated_at = now()
          WHERE case_id = $1::uuid`,
        [treatment.case_id, started.instance.instanceId, started.instance.currentStageKey],
      );

      await c.query('COMMIT');

      const persisted = (await c.query(
        `SELECT
           l.stage AS lead_stage,
           c.owner_subject_id,
           c.workflow_instance_id,
           c.stage_key,
           w.current_stage_key,
           a.participant_key,
           a.target_kind,
           a.target_key,
           a.assigned_by_subject_id
         FROM platform.crm_leads l
         JOIN platform.crm_cases c
           ON c.tenant_id = l.tenant_id
          AND c.account_id = l.account_id
          AND c.contact_id = l.contact_id
         JOIN platform.workflow_instances w
           ON w.tenant_id = c.tenant_id
          AND w.instance_id = c.workflow_instance_id
         JOIN platform.workflow_participant_assignments a
           ON a.tenant_id = w.tenant_id
          AND a.instance_id = w.instance_id
          AND a.stage_key = w.current_stage_key
          AND a.participant_key = 'owner'
        WHERE l.tenant_id = $1::uuid
          AND l.lead_id = $2::uuid
          AND c.case_id = $3::uuid`,
        [tenantId, leadId, treatment.case_id],
      )).rows[0];

      assert.deepEqual(persisted, {
        lead_stage: 'WON',
        owner_subject_id: leadOwner,
        workflow_instance_id: started.instance.instanceId,
        stage_key: 'INTAKE',
        current_stage_key: 'INTAKE',
        participant_key: 'owner',
        target_kind: 'USER',
        target_key: leadOwner,
        assigned_by_subject_id: converter,
      });
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    }
  } finally {
    c.release();
    await p.end();
  }
});
