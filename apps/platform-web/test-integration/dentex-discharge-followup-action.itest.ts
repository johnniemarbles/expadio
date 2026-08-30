import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  appendCrmCaseLifecycleEvent,
} from '../lib/crm-case-lifecycle-event';
import {
  materializeCrmCaseGovernedActionsForEvent,
} from '../lib/crm-case-governed-actions';
import { executeGovernedScheduleAction } from '../lib/governed-schedule-executor';
import { runScheduledGovernedActionWorkerOnce } from '../lib/scheduled-governed-action-worker';

const CAPABILITY_KEY = 'communication.email.send';

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

test('DENTEX discharge schedules a +7 day follow-up and queues it only when due', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const treatmentId = randomUUID();
    const workflowInstanceId = randomUUID();
    const actor = `${tenantId.slice(0, 8)}-reviewer`;
    const patientEmail = 'dentex.followup@example.test';

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'DENTEX follow-up tenant', 'dentex')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    const accountId = (await c.query(
      `INSERT INTO platform.crm_accounts
         (tenant_id, name, industry, lifecycle_stage)
       VALUES ($1::uuid, 'Follow-up Dental', 'Dental', 'CUSTOMER')
       RETURNING account_id`,
      [tenantId],
    )).rows[0].account_id as string;

    const contactId = (await c.query(
      `INSERT INTO platform.crm_contacts
         (tenant_id, account_id, full_name, email, title)
       VALUES (
         $1::uuid, $2::uuid, 'Mira Patient', $3, 'Patient'
       )
       RETURNING contact_id`,
      [tenantId, accountId, patientEmail],
    )).rows[0].contact_id as string;

    await c.query(
      `INSERT INTO platform.crm_cases (
         case_id, tenant_id, account_id, contact_id, subject, priority, status,
         blueprint_key, stage_key, owner_subject_id, attributes,
         attributes_schema_version, industry_pack_vertical_key,
         industry_pack_version, industry_pack_runtime_source
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid,
         'Root canal — UR6', 'NORMAL', 'RESOLVED',
         'crm.case', 'RESOLVED', $5,
         '{"urgency":"Routine","procedureCode":"D3310"}'::jsonb,
         1, 'dentex', NULL, 'CODE_BASELINE'
       )`,
      [treatmentId, tenantId, accountId, contactId, actor],
    );

    const capabilityId = (await c.query(
      `INSERT INTO platform.capabilities (capability_key, display_name)
       VALUES ($1, 'Communication email send')
       ON CONFLICT (capability_key)
       DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING capability_id`,
      [CAPABILITY_KEY],
    )).rows[0].capability_id as string;

    const connectorId = (await c.query(
      `INSERT INTO platform.connectors (
         connector_key, provider_type, provider_key, ownership_scope, tenant_id,
         health, priority, enabled, fallback_enabled
       ) VALUES (
         $1, 'email', 'resend', 'TENANT', $2::uuid,
         'HEALTHY', 1, true, false
       )
       RETURNING connector_id`,
      [`resend-${tenantId}`, tenantId],
    )).rows[0].connector_id as string;

    await c.query(
      `INSERT INTO platform.connector_capabilities (connector_id, capability_id)
       VALUES ($1::uuid, $2::uuid)`,
      [connectorId, capabilityId],
    );

    await c.query(
      `INSERT INTO platform.communication_templates (
         scope, tenant_id, trigger_key, channel, locale, content_format,
         subject, body, required_variables, default_variables, status
       ) VALUES (
         'TENANT', $1::uuid, 'patient.follow_up', 'email', 'en', 'TEXT',
         'Your treatment follow-up',
         'Hello {{patientName}}, your follow-up for {{treatmentSubject}} is ready.',
         '["patientName","treatmentSubject"]'::jsonb,
         '{}'::jsonb, 'ACTIVE'
       )`,
      [tenantId],
    );

    let eventId = '';
    await c.query('BEGIN');
    try {
      const appended = await appendCrmCaseLifecycleEvent(c, {
        tenantId,
        caseId: treatmentId,
        workflowInstanceId,
        fromStageKey: 'REVIEW',
        toStageKey: 'RESOLVED',
        actorSubjectId: actor,
        correlationId: 'dentex-treatment-journey',
        provenance: {
          verticalKey: 'dentex',
          version: null,
          runtimeSource: 'CODE_BASELINE',
        },
        occurredAt: new Date('2026-08-30T13:00:00.000Z'),
      });
      assert.ok(appended);
      eventId = appended.event.eventId;
      assert.equal(appended.event.eventType, 'Treatment.Discharged');
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    }

    const materialized = await materializeCrmCaseGovernedActionsForEvent(c, {
      tenantId,
      eventId,
      now: () => new Date('2026-08-30T13:00:01.000Z'),
    });

    assert.equal(materialized.length, 1);
    const persisted = materialized[0];
    assert.equal(persisted?.status, 'PERSISTED');
    if (persisted?.status !== 'PERSISTED') {
      throw new Error('expected persisted follow-up action');
    }

    assert.equal(persisted.ruleKey, 'dentex.treatment.discharge.patient-follow-up');
    assert.equal(persisted.intent.executorClass, 'SCHEDULE');
    assert.equal(persisted.intent.actionKey, 'patient.follow_up.schedule');
    assert.deepEqual(persisted.intent.configuration, {
      delaySeconds: 604800,
      target: {
        executorClass: 'COMMUNICATE',
        actionKey: 'patient.follow_up',
        configuration: {
          triggerKey: 'patient.follow_up',
          recipient: { email: patientEmail },
          variables: {
            patientName: 'Mira Patient',
            treatmentSubject: 'Root canal — UR6',
          },
          purpose: 'transactional',
          consentRequired: false,
          channel: 'email',
          locale: 'en',
          capabilityKey: CAPABILITY_KEY,
        },
      },
    });

    const execution = await executeGovernedScheduleAction(c, {
      intent: persisted.intent,
      now: () => new Date('2026-08-30T13:00:02.000Z'),
    });

    assert.equal(execution.replayed, false);
    assert.equal(execution.attempt.status, 'QUEUED');
    assert.equal(execution.scheduled?.dueAt.toISOString(), '2026-09-06T13:00:00.000Z');

    assert.deepEqual(
      await runScheduledGovernedActionWorkerOnce(c, {
        tenantId,
        now: () => new Date('2026-09-06T12:59:59.000Z'),
      }),
      { status: 'IDLE' },
    );

    const due = await runScheduledGovernedActionWorkerOnce(c, {
      tenantId,
      now: () => new Date('2026-09-06T13:00:00.000Z'),
    });
    assert.equal(due.status, 'MATERIALIZED');
    if (due.status !== 'MATERIALIZED' || due.communication === null) {
      throw new Error('expected due DENTEX follow-up to materialize and queue');
    }
    assert.equal(due.communication.queue?.queued, true);
    if (due.communication.queue === null || !due.communication.queue.queued) {
      throw new Error('expected scheduled communication to queue');
    }
    assert.equal(due.communication.queue.delivery.state, 'PENDING');
    assert.equal(due.communication.attempt.status, 'QUEUED');
    assert.equal(
      due.communication.queue.preparedDispatch.rendered.body,
      'Hello Mira Patient, your follow-up for Root canal — UR6 is ready.',
    );

    const persistedPath = (await c.query(
      `SELECT
         event.event_type,
         outbox.status AS event_outbox_status,
         intent.action_key,
         intent.executor_class,
         delivery.state AS delivery_state,
         attempt.status AS execution_status
       FROM platform.domain_events event
       JOIN platform.domain_event_outbox outbox
         ON outbox.tenant_id = event.tenant_id
        AND outbox.event_id = event.event_id
       JOIN platform.governed_action_intents intent
         ON intent.tenant_id = event.tenant_id
        AND intent.source_event_id = event.event_id
       JOIN platform.governed_action_execution_attempts attempt
         ON attempt.tenant_id = intent.tenant_id
        AND attempt.action_intent_id = intent.action_intent_id
       JOIN platform.communication_deliveries delivery
         ON delivery.tenant_id = intent.tenant_id
        AND delivery.idempotency_key = intent.idempotency_key
      WHERE event.tenant_id = $1::uuid
        AND event.event_id = $2::uuid`,
      [tenantId, eventId],
    )).rows[0];

    assert.deepEqual(persistedPath, {
      event_type: 'Treatment.Discharged',
      event_outbox_status: 'PENDING',
      action_key: 'patient.follow_up',
      executor_class: 'COMMUNICATE',
      delivery_state: 'PENDING',
      execution_status: 'QUEUED',
    });
  } finally {
    c.release();
    await p.end();
  }
});

test('DENTEX discharge follow-up fails closed when Patient email is missing', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const caseId = randomUUID();

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'DENTEX missing email tenant', 'dentex')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    const contactId = (await c.query(
      `INSERT INTO platform.crm_contacts (tenant_id, full_name, title)
       VALUES ($1::uuid, 'No Email Patient', 'Patient')
       RETURNING contact_id`,
      [tenantId],
    )).rows[0].contact_id as string;

    await c.query(
      `INSERT INTO platform.crm_cases (
         case_id, tenant_id, contact_id, subject, priority, status,
         blueprint_key, stage_key, attributes, attributes_schema_version,
         industry_pack_vertical_key, industry_pack_version,
         industry_pack_runtime_source
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, 'No email treatment',
         'NORMAL', 'RESOLVED', 'crm.case', 'RESOLVED',
         '{"urgency":"Routine"}'::jsonb, 1,
         'dentex', NULL, 'CODE_BASELINE'
       )`,
      [caseId, tenantId, contactId],
    );

    const appended = await appendCrmCaseLifecycleEvent(c, {
      tenantId,
      caseId,
      workflowInstanceId: randomUUID(),
      fromStageKey: 'REVIEW',
      toStageKey: 'RESOLVED',
      actorSubjectId: 'reviewer-1',
      correlationId: 'missing-email',
      provenance: {
        verticalKey: 'dentex',
        version: null,
        runtimeSource: 'CODE_BASELINE',
      },
    });
    assert.ok(appended);

    const materialized = await materializeCrmCaseGovernedActionsForEvent(c, {
      tenantId,
      eventId: appended.event.eventId,
    });
    assert.equal(materialized.length, 1);
    assert.equal(materialized[0]?.status, 'SKIPPED');
    if (materialized[0]?.status !== 'SKIPPED') {
      throw new Error('expected binding failure');
    }
    assert.equal(materialized[0].reasonCode, 'BINDING_FAILED');

    const intents = (await c.query(
      `SELECT count(*)::int AS count
         FROM platform.governed_action_intents
        WHERE tenant_id = $1::uuid
          AND source_event_id = $2::uuid`,
      [tenantId, appended.event.eventId],
    )).rows[0]?.count;
    assert.equal(intents, 0);
  } finally {
    c.release();
    await p.end();
  }
});
