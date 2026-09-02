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
import { runCommunicationDeliveryWorkerOnce } from '../lib/communication-delivery-worker';
import { ingestVerifiedCommunicationProviderWebhook } from '../lib/communication-provider-webhook';
import { listBusinessExecutionTrace } from '../lib/business-execution-trace';
import { listCommunicationHealthSummary } from '../lib/communication-health-summary';

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
    const connectorKey = `resend-${tenantId}`;
    const serviceSubjectId = `dentex-communication-worker-${tenantId}`;
    const providerMessageId = `resend-dentex-${randomUUID()}`;
    const roleKey = `dentex-communication-worker-role-${randomUUID()}`;

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
      [connectorKey, tenantId],
    )).rows[0].connector_id as string;

    await c.query(
      `INSERT INTO platform.connector_capabilities (connector_id, capability_id)
       VALUES ($1::uuid, $2::uuid)`,
      [connectorId, capabilityId],
    );

    await c.query(
      `INSERT INTO platform.connector_credentials
         (connector_id, credential_ref, key_version, custody_mode, state)
       VALUES ($1::uuid, $2, 'v1', 'PLATFORM_MANAGED', 'ACTIVE')`,
      [connectorId, `vault://tenant/${tenantId}/connector/${connectorKey}/v1`],
    );

    await c.query(
      `INSERT INTO platform.communication_sender_identities (
         scope, tenant_id, channel, address, display_name, purposes,
         is_default, verification_status, status
       ) VALUES (
         'TENANT', $1::uuid, 'email', 'sender@example.test', 'DENTEX',
         ARRAY['transactional']::text[], true, 'VERIFIED', 'ACTIVE'
       )`,
      [tenantId],
    );

    const roleId = (await c.query(
      `INSERT INTO platform.authorization_roles
         (role_key, display_name, ownership_scope, tenant_id, status)
       VALUES ($1, 'DENTEX communication delivery worker', 'TENANT', $2::uuid, 'ACTIVE')
       RETURNING role_id`,
      [roleKey, tenantId],
    )).rows[0].role_id as string;

    await c.query(
      `INSERT INTO platform.authorization_role_capabilities
         (role_id, action, resource_type)
       VALUES ($1::uuid, 'credential.lease', 'connector-credential')`,
      [roleId],
    );

    await c.query(
      `INSERT INTO platform.authorization_assignments (
         tenant_id, subject_id, role_id, status,
         clearances, sensitive_compartments
       ) VALUES (
         $1::uuid, $2, $3::uuid, 'ACTIVE',
         ARRAY['sensitive']::text[],
         ARRAY['provider-credentials']::text[]
       )`,
      [tenantId, serviceSubjectId, roleId],
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

    assert.equal(materialized.length, 2);
    const persisted = materialized.find((result) =>
      result.ruleKey === 'dentex.treatment.discharge.patient-follow-up'
    );
    assert.equal(persisted?.status, 'PERSISTED');
    if (persisted?.status !== 'PERSISTED') {
      throw new Error('expected persisted scheduled follow-up action');
    }

    const taskIntent = materialized.find((result) =>
      result.ruleKey === 'dentex.treatment.discharge.follow-up-review-task'
    );
    assert.equal(taskIntent?.status, 'PERSISTED');
    if (taskIntent?.status !== 'PERSISTED') {
      throw new Error('expected persisted follow-up review task action');
    }
    assert.equal(taskIntent.intent.executorClass, 'CREATE_TASK');
    assert.equal(taskIntent.intent.actionKey, 'patient.follow_up.review_task');

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
         parent.action_key AS parent_action_key,
         parent.executor_class AS parent_executor_class,
         schedule.state AS schedule_state,
         schedule.due_at,
         child.action_key AS child_action_key,
         child.executor_class AS child_executor_class,
         delivery.state AS delivery_state,
         attempt.status AS execution_status
       FROM platform.domain_events event
       JOIN platform.domain_event_outbox outbox
         ON outbox.tenant_id = event.tenant_id
        AND outbox.event_id = event.event_id
       JOIN platform.governed_action_intents parent
         ON parent.tenant_id = event.tenant_id
        AND parent.source_event_id = event.event_id
        AND parent.executor_class = 'SCHEDULE'
       JOIN platform.scheduled_governed_actions schedule
         ON schedule.tenant_id = parent.tenant_id
        AND schedule.parent_action_intent_id = parent.action_intent_id
       JOIN platform.governed_action_intents child
         ON child.tenant_id = schedule.tenant_id
        AND child.action_intent_id = schedule.child_action_intent_id
       JOIN platform.governed_action_execution_attempts attempt
         ON attempt.tenant_id = child.tenant_id
        AND attempt.action_intent_id = child.action_intent_id
       JOIN platform.communication_deliveries delivery
         ON delivery.tenant_id = child.tenant_id
        AND delivery.idempotency_key = child.idempotency_key
      WHERE event.tenant_id = $1::uuid
        AND event.event_id = $2::uuid`,
      [tenantId, eventId],
    )).rows[0];

    assert.deepEqual(persistedPath, {
      event_type: 'Treatment.Discharged',
      event_outbox_status: 'PENDING',
      parent_action_key: 'patient.follow_up.schedule',
      parent_executor_class: 'SCHEDULE',
      schedule_state: 'MATERIALIZED',
      due_at: new Date('2026-09-06T13:00:00.000Z'),
      child_action_key: 'patient.follow_up',
      child_executor_class: 'COMMUNICATE',
      delivery_state: 'PENDING',
      execution_status: 'QUEUED',
    });

    let providerCallCount = 0;
    const delivered = await runCommunicationDeliveryWorkerOnce(c, {
      tenantId,
      options: {
        serviceSubjectId,
        now: () => new Date('2026-09-06T13:00:01.000Z'),
        secretResolver: {
          async resolve() {
            return { value: 're_dentex_vertical_proof_token', version: 'v1' };
          },
        },
        fetchImpl: async (input, init) => {
          providerCallCount += 1;
          assert.equal(String(input), 'https://api.resend.com/emails');
          const headers = new Headers(init?.headers);
          assert.equal(
            headers.get('Authorization'),
            'Bearer re_dentex_vertical_proof_token',
          );
          assert.ok(headers.get('Idempotency-Key'));
          const body = JSON.parse(String(init?.body)) as {
            to?: readonly string[];
            subject?: string;
            text?: string;
          };
          assert.deepEqual(body.to, [patientEmail]);
          assert.equal(body.subject, 'Your treatment follow-up');
          assert.equal(
            body.text,
            'Hello Mira Patient, your follow-up for Root canal — UR6 is ready.',
          );
          return new Response(JSON.stringify({ id: providerMessageId }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    });

    assert.equal(providerCallCount, 1);
    assert.equal(delivered.status, 'ACCEPTED');
    assert.equal(delivered.reasonCode, 'PROVIDER_ACCEPTED');

    const acceptedDelivery = (await c.query(
      `SELECT delivery_id, state, provider_message_id, last_reason_code
         FROM platform.communication_deliveries
        WHERE tenant_id = $1::uuid
          AND idempotency_key = $2`,
      [tenantId, due.communication.queue.delivery.idempotencyKey],
    )).rows[0];

    assert.equal(acceptedDelivery.state, 'ACCEPTED');
    assert.equal(acceptedDelivery.provider_message_id, providerMessageId);
    assert.equal(acceptedDelivery.last_reason_code, 'PROVIDER_ACCEPTED');

    const webhook = await ingestVerifiedCommunicationProviderWebhook(c, {
      tenantId,
      providerKey: 'resend',
      connectorKey,
      providerEventId: `evt-dentex-${randomUUID()}`,
      providerMessageId,
      eventType: 'email.delivered',
      payload: {
        type: 'email.delivered',
        data: { email_id: providerMessageId },
      },
      receivedAt: new Date('2026-09-06T13:00:02.000Z'),
    });

    assert.deepEqual(webhook, {
      status: 'RECORDED',
      normalizedOutcome: 'DELIVERED',
      deliveryId: acceptedDelivery.delivery_id,
      previousDeliveryState: 'ACCEPTED',
      newDeliveryState: 'DELIVERED',
      reasonCode: 'PROVIDER_WEBHOOK_DELIVERED',
    });

    const webhookEvidence = (await c.query(
      `SELECT normalized_outcome, delivery_id, provider_message_id, reason_code
         FROM platform.communication_provider_webhook_events
        WHERE tenant_id = $1::uuid
          AND delivery_id = $2::uuid
        ORDER BY received_at DESC
        LIMIT 1`,
      [tenantId, acceptedDelivery.delivery_id],
    )).rows[0];

    assert.deepEqual(webhookEvidence, {
      normalized_outcome: 'DELIVERED',
      delivery_id: acceptedDelivery.delivery_id,
      provider_message_id: providerMessageId,
      reason_code: 'PROVIDER_WEBHOOK_DELIVERED',
    });

    const trace = await listBusinessExecutionTrace(c, {
      tenantId,
      rootEventId: eventId,
    });
    const traceKinds = new Set(trace.map((entry) => entry.traceKind));
    assert.ok(traceKinds.has('DOMAIN_EVENT'));
    assert.ok(traceKinds.has('DOMAIN_EVENT_OUTBOX'));
    assert.ok(traceKinds.has('GOVERNED_ACTION'));
    assert.ok(traceKinds.has('GOVERNED_ACTION_ATTEMPT'));
    assert.ok(traceKinds.has('SCHEDULED_ACTION'));
    assert.ok(traceKinds.has('COMMUNICATION_DELIVERY'));
    assert.ok(traceKinds.has('COMMUNICATION_PROVIDER_ATTEMPT'));

    const deliveryTrace = trace.find(
      (entry) => entry.traceKind === 'COMMUNICATION_DELIVERY',
    );
    assert.equal(deliveryTrace?.state, 'DELIVERED');
    assert.equal(deliveryTrace?.reasonCode, 'PROVIDER_WEBHOOK_DELIVERED');
    assert.equal(deliveryTrace?.aggregateId, treatmentId);

    const providerTrace = trace.find(
      (entry) => entry.traceKind === 'COMMUNICATION_PROVIDER_ATTEMPT',
    );
    assert.equal(providerTrace?.state, 'ACCEPTED');
    assert.equal(providerTrace?.reasonCode, 'PROVIDER_ACCEPTED');
    assert.equal(providerTrace?.metadata.providerMessageId, providerMessageId);

    const communicationHealth = await listCommunicationHealthSummary(c, {
      tenantId,
    });
    assert.deepEqual(
      communicationHealth.filter((entry) =>
        entry.healthKey !== 'communication_deliveries_in_flight'
      ),
      [],
    );
    assert.equal(
      communicationHealth.find(
        (entry) => entry.healthKey === 'communication_deliveries_in_flight',
      ),
      undefined,
    );
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
    assert.equal(materialized.length, 2);
    const followup = materialized.find((result) =>
      result.ruleKey === 'dentex.treatment.discharge.patient-follow-up'
    );
    assert.equal(followup?.status, 'SKIPPED');
    if (followup?.status !== 'SKIPPED') {
      throw new Error('expected scheduled follow-up binding failure');
    }
    assert.equal(followup.reasonCode, 'BINDING_FAILED');

    const reviewTask = materialized.find((result) =>
      result.ruleKey === 'dentex.treatment.discharge.follow-up-review-task'
    );
    assert.equal(reviewTask?.status, 'PERSISTED');
    if (reviewTask?.status !== 'PERSISTED') {
      throw new Error('expected review task intent to remain independently materializable');
    }
    assert.equal(reviewTask.intent.executorClass, 'CREATE_TASK');

    const intents = (await c.query(
      `SELECT count(*)::int AS count
         FROM platform.governed_action_intents
        WHERE tenant_id = $1::uuid
          AND source_event_id = $2::uuid`,
      [tenantId, appended.event.eventId],
    )).rows[0]?.count;
    assert.equal(intents, 1);
  } finally {
    c.release();
    await p.end();
  }
});
