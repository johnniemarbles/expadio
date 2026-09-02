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

test('DENTEX provider is an authoritative relationship projected into workflow participation', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const organizationId = randomUUID();
    const operator = `${tenantId.slice(0, 8)}-coordinator`;
    const providerA = `${tenantId.slice(0, 8)}-provider-a`;
    const providerB = `${tenantId.slice(0, 8)}-provider-b`;

    const providerDefinition = resolveRelationshipDefinitions(DENTEX_PACK, 'crm.case')
      .find((definition) => definition.key === 'provider');
    assert.ok(providerDefinition);
    assert.equal(providerDefinition.cardinality, 'ZERO_OR_ONE');

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'DENTEX provider relationship tenant', 'dentex')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    await c.query(
      `INSERT INTO platform.organizations
         (organization_id, tenant_id, organization_kind, name, status)
       VALUES ($1::uuid, $2::uuid, 'BUSINESS', 'Provider Practice Org', 'ACTIVE')`,
      [organizationId, tenantId],
    );

    const practiceId = (await c.query(
      `INSERT INTO platform.crm_accounts
         (tenant_id, organization_id, name, industry, lifecycle_stage)
       VALUES ($1::uuid, $2::uuid, 'Provider Dental', 'Dental', 'CUSTOMER')
       RETURNING account_id`,
      [tenantId, organizationId],
    )).rows[0].account_id as string;

    const patientId = (await c.query(
      `INSERT INTO platform.crm_contacts
         (tenant_id, account_id, full_name, email, title)
       VALUES ($1::uuid, $2::uuid, 'Provider Patient', 'provider-patient@example.test', 'Patient')
       RETURNING contact_id`,
      [tenantId, practiceId],
    )).rows[0].contact_id as string;

    const treatmentId = (await c.query(
      `INSERT INTO platform.crm_cases (
         tenant_id, account_id, contact_id, subject, priority, status,
         blueprint_key, owner_subject_id, attributes, attributes_schema_version,
         industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, 'Provider proof — UR6', 'NORMAL', 'OPEN',
         'crm.case', $4, '{"urgency":"Routine","tooth":"UR6"}'::jsonb, 1,
         'dentex', NULL, 'CODE_BASELINE'
       )
       RETURNING case_id`,
      [tenantId, practiceId, patientId, operator],
    )).rows[0].case_id as string;

    let workflowInstanceId = '';
    let stageKey = '';

    // First assignment: the domain relationship is written first, then projected
    // into the workflow participant slot in the same transaction.
    await c.query('BEGIN');
    try {
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
      workflowInstanceId = started.instance.instanceId;
      stageKey = started.instance.currentStageKey ?? '';
      assert.equal(stageKey, 'INTAKE');

      const relationships = new PostgresEntityRelationshipRepository(c);
      const assigned = await relationships.replaceSingle({
        tenantId,
        definition: providerDefinition,
        sourceEntityId: treatmentId,
        target: { entityType: 'iam.subject', entityId: providerA },
        actorSubjectId: operator,
      });
      assert.equal(assigned.target.entityId, providerA);

      await assignParticipant(c, {
        tenantId,
        instanceId: workflowInstanceId,
        stageKey,
        participantKey: 'provider',
        targetKind: 'USER',
        targetKey: assigned.target.entityId,
        assignedBySubjectId: operator,
      });

      await c.query(
        `UPDATE platform.crm_cases
            SET workflow_instance_id = $2::uuid,
                stage_key = $3,
                updated_at = now()
          WHERE case_id = $1::uuid`,
        [treatmentId, workflowInstanceId, stageKey],
      );
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    }

    // Reassignment proves domain history and workflow projection reconciliation:
    // Provider A ends; Provider B becomes authoritative and the workflow slot
    // follows B rather than becoming its own source of truth.
    await c.query('BEGIN');
    try {
      const relationships = new PostgresEntityRelationshipRepository(c);
      const reassigned = await relationships.replaceSingle({
        tenantId,
        definition: providerDefinition,
        sourceEntityId: treatmentId,
        target: { entityType: 'iam.subject', entityId: providerB },
        actorSubjectId: operator,
      });
      assert.equal(reassigned.target.entityId, providerB);

      await assignParticipant(c, {
        tenantId,
        instanceId: workflowInstanceId,
        stageKey,
        participantKey: 'provider',
        targetKind: 'USER',
        targetKey: reassigned.target.entityId,
        assignedBySubjectId: operator,
      });
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    }

    const relationships = new PostgresEntityRelationshipRepository(c);
    const active = await relationships.listActive({
      tenantId,
      sourceEntityType: 'crm.case',
      sourceEntityId: treatmentId,
      relationshipKey: 'provider',
    });
    assert.equal(active.length, 1);
    assert.equal(active[0]?.target.entityId, providerB);

    const history = await relationships.listHistory({
      tenantId,
      sourceEntityType: 'crm.case',
      sourceEntityId: treatmentId,
      relationshipKey: 'provider',
    });
    assert.equal(history.length, 2);

    const oldProvider = history.find((relationship) => relationship.target.entityId === providerA);
    const currentProvider = history.find((relationship) => relationship.target.entityId === providerB);
    assert.equal(oldProvider?.status, 'INACTIVE');
    assert.ok(oldProvider?.validUntil instanceof Date);
    assert.equal(oldProvider?.updatedBySubjectId, operator);
    assert.equal(currentProvider?.status, 'ACTIVE');
    assert.equal(currentProvider?.validUntil, null);

    const participant = (await c.query(
      `SELECT participant_key, target_kind, target_key, assigned_by_subject_id
         FROM platform.workflow_participant_assignments
        WHERE tenant_id = $1::uuid
          AND instance_id = $2::uuid
          AND stage_key = $3
          AND participant_key = 'provider'`,
      [tenantId, workflowInstanceId, stageKey],
    )).rows[0];

    assert.deepEqual(participant, {
      participant_key: 'provider',
      target_kind: 'USER',
      target_key: providerB,
      assigned_by_subject_id: operator,
    });
  } finally {
    c.release();
    await p.end();
  }
});
