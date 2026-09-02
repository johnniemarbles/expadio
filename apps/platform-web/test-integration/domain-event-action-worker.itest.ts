import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { appendCrmCaseLifecycleEvent } from '../lib/crm-case-lifecycle-event';
import { processOneDomainEventActionWorkItem } from '../lib/domain-event-action-worker';
import { loadExecutionTraceForEvent } from '../lib/execution-trace';

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

async function seedAcmeFollowupCase(c: pg.PoolClient) {
  const tenantId = randomUUID();
  const requestId = randomUUID();
  const actor = `${tenantId.slice(0, 8)}-reviewer`;
  const clientEmail = `patient-${tenantId}@example.test`;

  await c.query(
    `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
     VALUES ($1::uuid, 'Worker ACME Corp tenant', 'acme-corp')`,
    [tenantId],
  );
  await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

  const accountId = (await c.query(
    `INSERT INTO platform.crm_accounts
       (tenant_id, name, industry, lifecycle_stage)
     VALUES ($1::uuid, 'Worker Client', 'Services', 'CUSTOMER')
     RETURNING account_id`,
    [tenantId],
  )).rows[0].account_id as string;

  const contactId = (await c.query(
    `INSERT INTO platform.crm_contacts
       (tenant_id, account_id, full_name, email, title)
     VALUES ($1::uuid, $2::uuid, 'Worker Contact', $3, 'Contact')
     RETURNING contact_id`,
    [tenantId, accountId, clientEmail],
  )).rows[0].contact_id as string;

  await c.query(
    `INSERT INTO platform.crm_cases (
       case_id, tenant_id, account_id, contact_id, subject, priority, status,
       blueprint_key, stage_key, owner_subject_id, attributes,
       attributes_schema_version, industry_pack_vertical_key,
       industry_pack_version, industry_pack_runtime_source
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid,
       'Worker Service Request', 'NORMAL', 'RESOLVED',
       'crm.case', 'RESOLVED', $5,
       '{"serviceType":"Consulting","priority":"Normal"}'::jsonb,
       1, 'acme-corp', NULL, 'CODE_BASELINE'
     )`,
    [requestId, tenantId, accountId, contactId, actor],
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
    [`resend-worker-${tenantId}`, tenantId],
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
       'TENANT', $1::uuid, 'client.follow_up', 'email', 'en', 'TEXT',
       'Your service request follow-up',
       'Hello {{clientName}}, your follow-up for {{requestSubject}} is ready.',
       '["clientName","requestSubject"]'::jsonb,
       '{}'::jsonb, 'ACTIVE'
     )`,
    [tenantId],
  );

  const appended = await appendCrmCaseLifecycleEvent(c, {
    tenantId,
    caseId: requestId,
    workflowInstanceId: randomUUID(),
    fromStageKey: 'REVIEW',
    toStageKey: 'RESOLVED',
    actorSubjectId: actor,
    correlationId: 'worker-acme-corp-service-request-journey',
    provenance: {
      verticalKey: 'acme-corp',
      version: null,
      runtimeSource: 'CODE_BASELINE',
    },
    occurredAt: new Date('2026-08-30T14:30:00.000Z'),
  });
  assert.ok(appended);
  return { tenantId, eventId: appended.event.eventId };
}

test('worker claims completed service request, schedules follow-up, then publishes outbox', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const { tenantId, eventId } = await seedAcmeFollowupCase(c);

    const workerNow = new Date(Date.now() + 60_000);
    const result = await processOneDomainEventActionWorkItem(c, {
      tenantId,
      now: () => workerNow,
    });

    assert.equal(result.status, 'PUBLISHED');
    if (result.status !== 'PUBLISHED') throw new Error('expected worker publish');
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions.every((action) => action.status === 'PERSISTED'), true);
    assert.equal(result.communications.length, 0);
    assert.equal(result.schedules.length, 1);
    assert.equal(result.tasks.length, 0);
    assert.equal(result.schedules[0]?.attempt.status, 'QUEUED');
    assert.equal(result.schedules[0]?.scheduled?.dueAt.toISOString(), '2026-09-02T14:30:00.000Z');

    const row = (await c.query(
      `SELECT
         outbox.status AS outbox_status,
         intent.action_key,
         schedule.state AS schedule_state,
         schedule.due_at,
         attempt.status AS execution_status
       FROM platform.domain_event_outbox outbox
       JOIN platform.governed_action_intents intent
         ON intent.tenant_id = outbox.tenant_id
        AND intent.source_event_id = outbox.event_id
       JOIN platform.scheduled_governed_actions schedule
         ON schedule.tenant_id = intent.tenant_id
        AND schedule.parent_action_intent_id = intent.action_intent_id
       JOIN platform.governed_action_execution_attempts attempt
         ON attempt.tenant_id = intent.tenant_id
        AND attempt.action_intent_id = intent.action_intent_id
      WHERE outbox.tenant_id = $1::uuid
        AND outbox.event_id = $2::uuid
        AND intent.executor_class = 'SCHEDULE'`,
      [tenantId, eventId],
    )).rows[0];

    assert.deepEqual(row, {
      outbox_status: 'PUBLISHED',
      action_key: 'client.follow_up.schedule',
      schedule_state: 'PENDING',
      due_at: new Date('2026-09-02T14:30:00.000Z'),
      execution_status: 'QUEUED',
    });

    const trace = await loadExecutionTraceForEvent(c, { tenantId, eventId });
    assert.ok(trace);
    assert.equal(trace.event.eventType, 'ServiceRequest.Completed');
    assert.equal(trace.event.outbox?.status, 'PUBLISHED');
    assert.deepEqual(
      trace.actions.map((action) => action.executorClass).sort(),
      ['SCHEDULE'],
    );
    assert.equal(trace.schedules.length, 1);
    assert.equal(trace.tasks.length, 0);
    assert.equal(trace.deliveries.length, 0);

    assert.deepEqual(await processOneDomainEventActionWorkItem(c, { tenantId }), {
      status: 'IDLE',
    });
  } finally {
    c.release();
    await p.end();
  }
});

test('worker retries materialization failures without creating an intent', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const caseId = randomUUID();
    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Worker missing email tenant', 'acme-corp')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    const contactId = (await c.query(
      `INSERT INTO platform.crm_contacts (tenant_id, full_name, title)
       VALUES ($1::uuid, 'Missing Email', 'Contact') RETURNING contact_id`,
      [tenantId],
    )).rows[0].contact_id as string;
    await c.query(
      `INSERT INTO platform.crm_cases (
         case_id, tenant_id, contact_id, subject, priority, status,
         blueprint_key, stage_key, attributes, attributes_schema_version,
         industry_pack_vertical_key, industry_pack_runtime_source
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, 'Missing-email service request',
         'NORMAL', 'RESOLVED', 'crm.case', 'RESOLVED',
         '{"serviceType":"Consulting","priority":"Normal"}'::jsonb, 1, 'acme-corp', 'CODE_BASELINE'
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
      correlationId: 'worker-missing-email',
      provenance: { verticalKey: 'acme-corp', version: null, runtimeSource: 'CODE_BASELINE' },
    });
    assert.ok(appended);

    const workerNow = new Date(Date.now() + 60_000);
    const result = await processOneDomainEventActionWorkItem(c, {
      tenantId,
      now: () => workerNow,
      maxAttempts: 2,
    });
    assert.equal(result.status, 'FAILED');
    if (result.status !== 'FAILED') throw new Error('expected retryable failure');
    assert.match(result.reason, /BINDING_FAILED/);

    const row = (await c.query(
      `SELECT status, attempts,
              (available_at > $3::timestamptz) AS retry_scheduled,
              (SELECT count(*)::int FROM platform.governed_action_intents
                WHERE tenant_id = $1::uuid AND source_event_id = $2::uuid) AS intents,
              (SELECT count(*)::int FROM platform.operational_tasks
                WHERE tenant_id = $1::uuid AND source_event_id = $2::uuid) AS tasks
         FROM platform.domain_event_outbox
        WHERE tenant_id = $1::uuid AND event_id = $2::uuid`,
      [tenantId, appended.event.eventId, workerNow],
    )).rows[0];
    assert.deepEqual(row, {
      status: 'FAILED',
      attempts: 1,
      retry_scheduled: true,
      intents: 0,
      tasks: 0,
    });
  } finally {
    c.release();
    await p.end();
  }
});
