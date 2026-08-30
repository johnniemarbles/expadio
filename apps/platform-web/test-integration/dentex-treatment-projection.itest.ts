import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  DENTEX_PACK,
  resolveRelationshipDefinitions,
} from '@expadio/industry-packs';
import { PostgresEntityRelationshipRepository } from '@expadio/postgres-runtime/entity-relationship';
import { startWorkflow } from '../lib/workflow-runtime';
import { loadDentexTreatmentWorkspace } from '../lib/dentex-treatment-projection';

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

test('DENTEX Treatment workspace hydrates CRM, relationship, workflow, and Care Plan authorities', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const organizationId = randomUUID();
    const owner = `${tenantId.slice(0, 8)}-owner`;
    const provider = `${tenantId.slice(0, 8)}-provider`;

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'DENTEX Treatment projection tenant', 'dentex')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    await c.query(
      `INSERT INTO platform.organizations
         (organization_id, tenant_id, organization_kind, name, status)
       VALUES ($1::uuid, $2::uuid, 'BUSINESS', 'Projection Practice Org', 'ACTIVE')`,
      [organizationId, tenantId],
    );

    const practiceId = (await c.query(
      `INSERT INTO platform.crm_accounts
         (tenant_id, organization_id, name, industry, lifecycle_stage)
       VALUES ($1::uuid, $2::uuid, 'Projection Dental', 'Dental', 'CUSTOMER')
       RETURNING account_id`,
      [tenantId, organizationId],
    )).rows[0].account_id as string;

    const patientId = (await c.query(
      `INSERT INTO platform.crm_contacts
         (tenant_id, account_id, full_name, email, phone, title)
       VALUES (
         $1::uuid, $2::uuid, 'Asha Projection',
         'asha-projection@example.test', '+15555550101', 'Patient'
       )
       RETURNING contact_id`,
      [tenantId, practiceId],
    )).rows[0].contact_id as string;

    const treatmentId = (await c.query(
      `INSERT INTO platform.crm_cases (
         tenant_id, account_id, contact_id, subject, description, priority, status,
         blueprint_key, owner_subject_id, attributes, attributes_schema_version,
         industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, 'Root canal — UR6',
         'Pain and sensitivity', 'HIGH', 'OPEN',
         'crm.case', $4,
         '{"urgency":"Priority","tooth":"UR6","procedureCode":"D3310"}'::jsonb,
         1, 'dentex', NULL, 'CODE_BASELINE'
       )
       RETURNING case_id`,
      [tenantId, practiceId, patientId, owner],
    )).rows[0].case_id as string;

    const agreementId = (await c.query(
      `INSERT INTO platform.crm_agreements (
         tenant_id, account_id, title, status, starts_on, owner_subject_id
       ) VALUES (
         $1::uuid, $2::uuid, 'Root canal care plan', 'ACTIVE',
         DATE '2026-08-30', $3
       )
       RETURNING agreement_id`,
      [tenantId, practiceId, owner],
    )).rows[0].agreement_id as string;

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

    const providerDefinition = resolveRelationshipDefinitions(DENTEX_PACK, 'crm.case')
      .find((definition) => definition.key === 'provider');
    assert.ok(providerDefinition);

    await c.query('BEGIN');
    try {
      const relationships = new PostgresEntityRelationshipRepository(c);
      await relationships.replaceSingle({
        tenantId,
        definition: providerDefinition,
        sourceEntityId: treatmentId,
        target: {
          entityType: 'iam.subject',
          entityId: provider,
        },
        actorSubjectId: owner,
      });
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    }

    const workspace = await loadDentexTreatmentWorkspace(c, {
      tenantId,
      treatmentId,
    });
    assert.ok(workspace);

    assert.deepEqual(workspace.treatment, {
      treatmentId,
      tenantId,
      practiceId,
      patientId,
      carePlanAgreementId: agreementId,
      subject: 'Root canal — UR6',
      description: 'Pain and sensitivity',
      priority: 'HIGH',
      status: 'OPEN',
      stage: 'INTAKE',
      schemaVersion: 1,
      attributes: {
        urgency: 'Priority',
        tooth: 'UR6',
        procedureCode: 'D3310',
      },
    });

    assert.deepEqual(workspace.patient, {
      patientId,
      fullName: 'Asha Projection',
      email: 'asha-projection@example.test',
      phone: '+15555550101',
      status: 'ACTIVE',
    });
    assert.deepEqual(workspace.practice, {
      practiceId,
      name: 'Projection Dental',
      industry: 'Dental',
      status: 'ACTIVE',
    });
    assert.deepEqual(workspace.owner, { subjectId: owner });
    assert.deepEqual(workspace.provider, { subjectId: provider });
    assert.equal(workspace.workflow?.instanceId, started.instance.instanceId);
    assert.equal(workspace.workflow?.currentStage, 'INTAKE');
    assert.equal(workspace.workflow?.state, 'RUNNING');
    assert.equal(workspace.carePlan?.agreementId, agreementId);
    assert.equal(workspace.carePlan?.title, 'Root canal care plan');
    assert.equal(workspace.carePlan?.startsOn, '2026-08-30');
    assert.deepEqual(workspace.pack, {
      verticalKey: 'dentex',
      version: null,
      runtimeSource: 'CODE_BASELINE',
    });
  } finally {
    c.release();
    await p.end();
  }
});

test('DENTEX Treatment workspace keeps missing Patient visible instead of inventing one', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const organizationId = randomUUID();

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'DENTEX incomplete Treatment tenant', 'dentex')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    await c.query(
      `INSERT INTO platform.organizations
         (organization_id, tenant_id, organization_kind, name, status)
       VALUES ($1::uuid, $2::uuid, 'BUSINESS', 'Incomplete Practice Org', 'ACTIVE')`,
      [organizationId, tenantId],
    );
    const practiceId = (await c.query(
      `INSERT INTO platform.crm_accounts
         (tenant_id, organization_id, name, industry, lifecycle_stage)
       VALUES ($1::uuid, $2::uuid, 'Incomplete Dental', 'Dental', 'CUSTOMER')
       RETURNING account_id`,
      [tenantId, organizationId],
    )).rows[0].account_id as string;

    const treatmentId = (await c.query(
      `INSERT INTO platform.crm_cases (
         tenant_id, account_id, subject, priority, status, blueprint_key,
         owner_subject_id, attributes, attributes_schema_version,
         industry_pack_vertical_key, industry_pack_runtime_source
       ) VALUES (
         $1::uuid, $2::uuid, 'Consultation awaiting patient', 'NORMAL', 'OPEN',
         'crm.case', 'coordinator',
         '{"urgency":"Routine"}'::jsonb, 1, 'dentex', 'CODE_BASELINE'
       )
       RETURNING case_id`,
      [tenantId, practiceId],
    )).rows[0].case_id as string;

    const workspace = await loadDentexTreatmentWorkspace(c, {
      tenantId,
      treatmentId,
    });
    assert.ok(workspace);
    assert.equal(workspace.patient, null);
    assert.equal(workspace.treatment.patientId, null);
    assert.equal(workspace.practice?.practiceId, practiceId);
  } finally {
    c.release();
    await p.end();
  }
});
