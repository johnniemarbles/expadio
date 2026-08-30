import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { appendCrmCaseStageChangedEvent } from '../lib/crm-case-stage-events';
import { assignParticipant } from '../lib/workflow-participants';
import { startWorkflow, transitionWorkflow } from '../lib/workflow-runtime';

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

test('CRM case stage mutation, Domain Event, and outbox commit and roll back atomically', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const organizationId = randomUUID();
    const actor = `${tenantId.slice(0, 8)}-dentist`;
    const reviewer = `${tenantId.slice(0, 8)}-reviewer`;

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'CRM case event tenant', 'dentex')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    await c.query(
      `INSERT INTO platform.organizations
         (organization_id, tenant_id, organization_kind, name, status)
       VALUES ($1::uuid, $2::uuid, 'BUSINESS', 'Event Dental Org', 'ACTIVE')`,
      [organizationId, tenantId],
    );

    const accountId = (await c.query(
      `INSERT INTO platform.crm_accounts
         (tenant_id, organization_id, name, industry, lifecycle_stage)
       VALUES ($1::uuid, $2::uuid, 'Event Dental', 'Dental', 'CUSTOMER')
       RETURNING account_id`,
      [tenantId, organizationId],
    )).rows[0].account_id as string;

    const contactId = (await c.query(
      `INSERT INTO platform.crm_contacts
         (tenant_id, account_id, full_name, email, title)
       VALUES ($1::uuid, $2::uuid, 'Event Patient', 'event.patient@example.test', 'Patient')
       RETURNING contact_id`,
      [tenantId, accountId],
    )).rows[0].contact_id as string;

    const caseId = (await c.query(
      `INSERT INTO platform.crm_cases (
         tenant_id, account_id, contact_id, subject, priority, status,
         blueprint_key, owner_subject_id, attributes, attributes_schema_version,
         industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, 'Event Treatment', 'NORMAL', 'OPEN',
         'crm.case', $4, '{"urgency":"Routine"}'::jsonb, 1,
         'dentex', NULL, 'CODE_BASELINE'
       )
       RETURNING case_id`,
      [tenantId, accountId, contactId, actor],
    )).rows[0].case_id as string;

    const started = await startWorkflow(c, {
      tenantId,
      subjectType: 'crm.case',
      subjectId: caseId,
      blueprintKey: 'crm.case',
      industryPackProvenance: {
        runtimeSource: 'CODE_BASELINE',
        verticalKey: 'dentex',
      },
    });
    assert.ok(started.ok);

    await c.query(
      `UPDATE platform.crm_cases
          SET workflow_instance_id = $2::uuid, stage_key = $3
        WHERE case_id = $1::uuid`,
      [caseId, started.instance.instanceId, started.instance.currentStageKey],
    );

    await c.query('BEGIN');
    let committedEventId = '';
    let committedRevision = -1;
    try {
      const moved = await transitionWorkflow(c, {
        tenantId,
        instanceId: started.instance.instanceId,
        expectedRevision: started.instance.revision,
        toStageKey: 'IN_PROGRESS',
        requestedBySubjectId: actor,
      });
      assert.ok(moved.ok);

      await c.query(
        `UPDATE platform.crm_cases
            SET stage_key = $2, updated_at = now()
          WHERE case_id = $1::uuid`,
        [caseId, moved.instance.currentStageKey],
      );

      const appended = await appendCrmCaseStageChangedEvent(c, {
        tenantId,
        caseId,
        instanceId: started.instance.instanceId,
        previousStageKey: 'INTAKE',
        currentStageKey: moved.instance.currentStageKey ?? null,
        revision: moved.instance.revision,
        actorSubjectId: actor,
        correlationId: 'treatment-journey-1',
        pack: {
          verticalKey: 'dentex',
          version: null,
          runtimeSource: 'CODE_BASELINE',
        },
      });
      committedEventId = appended.event.eventId;
      committedRevision = moved.instance.revision;
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    }

    const committed = (await c.query(
      `SELECT
         c.stage_key,
         e.aggregate_type,
         e.aggregate_id,
         e.event_type,
         e.event_version,
         e.actor_subject_id,
         e.correlation_id,
         e.causation_id,
         e.pack_key,
         e.pack_version,
         e.payload,
         e.metadata,
         o.status AS outbox_status,
         o.partition_key
       FROM platform.crm_cases c
       JOIN platform.domain_events e
         ON e.tenant_id = c.tenant_id
        AND e.event_id = $3::uuid
       JOIN platform.domain_event_outbox o
         ON o.tenant_id = e.tenant_id
        AND o.event_id = e.event_id
      WHERE c.tenant_id = $1::uuid
        AND c.case_id = $2::uuid`,
      [tenantId, caseId, committedEventId],
    )).rows[0];

    assert.equal(committed.stage_key, 'IN_PROGRESS');
    assert.equal(committed.aggregate_type, 'crm.case');
    assert.equal(committed.aggregate_id, caseId);
    assert.equal(committed.event_type, 'crm.case.stage_changed');
    assert.equal(committed.event_version, 1);
    assert.equal(committed.actor_subject_id, actor);
    assert.equal(committed.correlation_id, 'treatment-journey-1');
    assert.equal(
      committed.causation_id,
      `workflow:${started.instance.instanceId}:revision:${committedRevision}`,
    );
    assert.equal(committed.pack_key, 'dentex');
    assert.equal(committed.pack_version, null);
    assert.deepEqual(committed.payload, {
      previousStageKey: 'INTAKE',
      currentStageKey: 'IN_PROGRESS',
      workflowInstanceId: started.instance.instanceId,
      workflowRevision: committedRevision,
    });
    assert.deepEqual(committed.metadata, {
      source: 'decision-fabric.crm-case-transition',
      industryPackRuntimeSource: 'CODE_BASELINE',
    });
    assert.equal(committed.outbox_status, 'PENDING');
    assert.equal(committed.partition_key, `crm.case:${caseId}`);

    await c.query(
      `UPDATE platform.crm_cases
          SET attributes = attributes || '{"procedureCode":"D3310"}'::jsonb
        WHERE case_id = $1::uuid`,
      [caseId],
    );
    await assignParticipant(c, {
      tenantId,
      instanceId: started.instance.instanceId,
      stageKey: 'REVIEW',
      participantKey: 'reviewer',
      targetKind: 'USER',
      targetKey: reviewer,
      assignedBySubjectId: actor,
    });

    await c.query('BEGIN');
    let rolledBackEventId = '';
    try {
      const current = (await c.query(
        `SELECT revision
           FROM platform.workflow_instances
          WHERE tenant_id = $1::uuid
            AND instance_id = $2::uuid`,
        [tenantId, started.instance.instanceId],
      )).rows[0].revision as number;

      const moved = await transitionWorkflow(c, {
        tenantId,
        instanceId: started.instance.instanceId,
        expectedRevision: current,
        toStageKey: 'REVIEW',
        requestedBySubjectId: actor,
      });
      assert.ok(moved.ok);

      await c.query(
        `UPDATE platform.crm_cases
            SET stage_key = $2, updated_at = now()
          WHERE case_id = $1::uuid`,
        [caseId, moved.instance.currentStageKey],
      );

      const appended = await appendCrmCaseStageChangedEvent(c, {
        tenantId,
        caseId,
        instanceId: started.instance.instanceId,
        previousStageKey: 'IN_PROGRESS',
        currentStageKey: moved.instance.currentStageKey ?? null,
        revision: moved.instance.revision,
        actorSubjectId: actor,
        correlationId: 'treatment-journey-1',
        pack: {
          verticalKey: 'dentex',
          version: null,
          runtimeSource: 'CODE_BASELINE',
        },
      });
      rolledBackEventId = appended.event.eventId;
      await c.query('ROLLBACK');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    }

    const rolledBack = (await c.query(
      `SELECT
         (SELECT stage_key
            FROM platform.crm_cases
           WHERE tenant_id = $1::uuid
             AND case_id = $2::uuid) AS stage_key,
         (SELECT current_stage_key
            FROM platform.workflow_instances
           WHERE tenant_id = $1::uuid
             AND instance_id = $3::uuid) AS workflow_stage,
         (SELECT count(*)::int
            FROM platform.domain_events
           WHERE tenant_id = $1::uuid
             AND event_id = $4::uuid) AS events,
         (SELECT count(*)::int
            FROM platform.domain_event_outbox
           WHERE tenant_id = $1::uuid
             AND event_id = $4::uuid) AS outbox`,
      [tenantId, caseId, started.instance.instanceId, rolledBackEventId],
    )).rows[0];

    assert.deepEqual(rolledBack, {
      stage_key: 'IN_PROGRESS',
      workflow_stage: 'IN_PROGRESS',
      events: 0,
      outbox: 0,
    });
  } finally {
    c.release();
    await p.end();
  }
});
