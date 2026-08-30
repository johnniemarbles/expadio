import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  appendCrmCaseLifecycleEvent,
} from '../lib/crm-case-lifecycle-event';
import {
  GovernedActionDomainEventConsumer,
  GOVERNED_ACTIONS_DOMAIN_EVENT_CONSUMER_KEY,
} from '../lib/governed-action-domain-event-consumer';
import {
  receiveDomainEventInboxDelivery,
} from '@expadio/postgres-runtime/domain-event-inbox';
import {
  runDomainEventInboxBatch,
} from '@expadio/postgres-runtime/domain-event-inbox-runner';
import {
  runDomainEventOutboxBatch,
} from '@expadio/postgres-runtime/domain-event-outbox-runner';

const CAPABILITY_KEY = 'communication.email.send';

function pool(): pg.Pool {
  return new pg.Pool({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    database: process.env.PGDATABASE ?? 'expadio_test',
    max: 2,
  });
}

test('DENTEX event publishes to inbox then processes through governed COMMUNICATE independently', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const treatmentId = randomUUID();
    const workflowInstanceId = randomUUID();
    const actor = `${tenantId.slice(0, 8)}-reviewer`;
    const patientEmail = 'inbox.followup@example.test';

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Governed action consumer tenant', 'dentex')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    const accountId = (await c.query(
      `INSERT INTO platform.crm_accounts
         (tenant_id, name, industry, lifecycle_stage)
       VALUES ($1::uuid, 'Inbox Dental', 'Dental', 'CUSTOMER')
       RETURNING account_id`,
      [tenantId],
    )).rows[0].account_id as string;

    const contactId = (await c.query(
      `INSERT INTO platform.crm_contacts
         (tenant_id, account_id, full_name, email, title)
       VALUES ($1::uuid, $2::uuid, 'Inbox Patient', $3, 'Patient')
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
         'Crown — UL6', 'NORMAL', 'RESOLVED',
         'crm.case', 'RESOLVED', $5,
         '{"urgency":"Routine","procedureCode":"D2740"}'::jsonb,
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
        correlationId: 'consumer-inbox-journey',
        provenance: {
          verticalKey: 'dentex',
          version: null,
          runtimeSource: 'CODE_BASELINE',
        },
        occurredAt: new Date('2026-08-30T16:00:00.000Z'),
      });
      assert.ok(appended);
      eventId = appended.event.eventId;
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    }

    const publication = await runDomainEventOutboxBatch(c, {
      tenantId,
      batchSize: 10,
      leaseSeconds: 60,
      maxAttempts: 3,
      now: (() => {
        const times = [
          new Date('2026-08-30T16:00:01.000Z'),
          new Date('2026-08-30T16:00:02.000Z'),
          new Date('2026-08-30T16:00:03.000Z'),
        ];
        let index = 0;
        return () => times[Math.min(index++, times.length - 1)]!;
      })(),
      publisher: {
        async publish({ item }) {
          assert.equal(item.eventId, eventId);
          await receiveDomainEventInboxDelivery(c, {
            tenantId: item.tenantId,
            consumerKey: GOVERNED_ACTIONS_DOMAIN_EVENT_CONSUMER_KEY,
            eventId: item.eventId,
            topic: item.topic,
            partitionKey: item.partitionKey,
            receivedAt: new Date('2026-08-30T16:00:02.500Z'),
          });
        },
      },
    });
    assert.deepEqual(publication, {
      claimed: 1,
      published: 1,
      failed: 0,
      dead: 0,
      claimLost: 0,
    });

    const beforeConsume = (await c.query(
      `SELECT
         outbox.status AS outbox_status,
         inbox.status AS inbox_status
       FROM platform.domain_event_outbox outbox
       JOIN platform.domain_event_inbox inbox
         ON inbox.tenant_id = outbox.tenant_id
        AND inbox.event_id = outbox.event_id
      WHERE outbox.tenant_id = $1::uuid
        AND outbox.event_id = $2::uuid
        AND inbox.consumer_key = $3`,
      [tenantId, eventId, GOVERNED_ACTIONS_DOMAIN_EVENT_CONSUMER_KEY],
    )).rows[0];

    assert.deepEqual(beforeConsume, {
      outbox_status: 'PUBLISHED',
      inbox_status: 'PENDING',
    });

    const consumerTimes = [
      new Date('2026-08-30T16:00:04.000Z'),
      new Date('2026-08-30T16:00:05.000Z'),
      new Date('2026-08-30T16:00:06.000Z'),
    ];
    let consumerClock = 0;

    const consumed = await runDomainEventInboxBatch(c, {
      tenantId,
      consumerKey: GOVERNED_ACTIONS_DOMAIN_EVENT_CONSUMER_KEY,
      batchSize: 10,
      leaseSeconds: 60,
      maxAttempts: 3,
      now: () => consumerTimes[Math.min(consumerClock++, consumerTimes.length - 1)]!,
      consumer: new GovernedActionDomainEventConsumer(c, {
        now: () => new Date('2026-08-30T16:00:05.500Z'),
        communicationNow: () => '2026-08-30T16:00:05.750Z',
      }),
    });

    assert.deepEqual(consumed, {
      claimed: 1,
      processed: 1,
      failed: 0,
      dead: 0,
      claimLost: 0,
    });

    const persisted = (await c.query(
      `SELECT
         outbox.status AS outbox_status,
         inbox.status AS inbox_status,
         intent.action_key,
         intent.executor_class,
         delivery.state AS delivery_state,
         attempt.status AS execution_status
       FROM platform.domain_event_outbox outbox
       JOIN platform.domain_event_inbox inbox
         ON inbox.tenant_id = outbox.tenant_id
        AND inbox.event_id = outbox.event_id
       JOIN platform.governed_action_intents intent
         ON intent.tenant_id = inbox.tenant_id
        AND intent.source_event_id = inbox.event_id
       JOIN platform.governed_action_execution_attempts attempt
         ON attempt.tenant_id = intent.tenant_id
        AND attempt.action_intent_id = intent.action_intent_id
       JOIN platform.communication_deliveries delivery
         ON delivery.tenant_id = intent.tenant_id
        AND delivery.idempotency_key = intent.idempotency_key
      WHERE outbox.tenant_id = $1::uuid
        AND outbox.event_id = $2::uuid
        AND inbox.consumer_key = $3`,
      [tenantId, eventId, GOVERNED_ACTIONS_DOMAIN_EVENT_CONSUMER_KEY],
    )).rows[0];

    assert.deepEqual(persisted, {
      outbox_status: 'PUBLISHED',
      inbox_status: 'PROCESSED',
      action_key: 'patient.follow_up',
      executor_class: 'COMMUNICATE',
      delivery_state: 'PENDING',
      execution_status: 'QUEUED',
    });

    // Transport redelivery after processing remains idempotent for this consumer.
    const replay = await receiveDomainEventInboxDelivery(c, {
      tenantId,
      consumerKey: GOVERNED_ACTIONS_DOMAIN_EVENT_CONSUMER_KEY,
      eventId,
      topic: 'domain.events',
      partitionKey: `crm.case:${treatmentId}`,
      receivedAt: new Date('2026-08-30T16:01:00.000Z'),
    });
    assert.equal(replay.status, 'PROCESSED');

    const counts = (await c.query(
      `SELECT
         (SELECT count(*)::int
            FROM platform.domain_event_inbox
           WHERE tenant_id = $1::uuid
             AND consumer_key = $3
             AND event_id = $2::uuid) AS inbox_rows,
         (SELECT count(*)::int
            FROM platform.governed_action_intents
           WHERE tenant_id = $1::uuid
             AND source_event_id = $2::uuid) AS intents,
         (SELECT count(*)::int
            FROM platform.communication_deliveries
           WHERE tenant_id = $1::uuid) AS deliveries`,
      [tenantId, eventId, GOVERNED_ACTIONS_DOMAIN_EVENT_CONSUMER_KEY],
    )).rows[0];

    assert.deepEqual(counts, {
      inbox_rows: 1,
      intents: 1,
      deliveries: 1,
    });
  } finally {
    c.release();
    await p.end();
  }
});
