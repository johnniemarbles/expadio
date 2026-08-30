import { setFixtureOutboxAvailableAt } from './outbox-fixture-clock.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { appendCrmCaseLifecycleEvent } from '../lib/crm-case-lifecycle-event';
import { runDomainEventActionWorkerBatch } from '../lib/domain-event-action-runner';

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

async function seedTenant(c: pg.PoolClient): Promise<string> {
  const tenantId = randomUUID();
  await c.query(
    `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
     VALUES ($1::uuid, 'Runner tenant', 'dentex')`,
    [tenantId],
  );
  await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

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
     ) RETURNING connector_id`,
    [`resend-runner-${tenantId}`, tenantId],
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
       'Runner follow-up', 'Hello {{patientName}} — {{treatmentSubject}}',
       '["patientName","treatmentSubject"]'::jsonb, '{}'::jsonb, 'ACTIVE'
     )`,
    [tenantId],
  );

  return tenantId;
}

async function seedCaseEvent(
  c: pg.PoolClient,
  input: { tenantId: string; hasEmail: boolean; subject: string },
): Promise<string> {
  const caseId = randomUUID();
  const accountId = (await c.query(
    `INSERT INTO platform.crm_accounts (tenant_id, name, industry, lifecycle_stage)
     VALUES ($1::uuid, 'Runner Dental', 'Dental', 'CUSTOMER')
     RETURNING account_id`,
    [input.tenantId],
  )).rows[0].account_id as string;
  const contactId = (await c.query(
    `INSERT INTO platform.crm_contacts (tenant_id, account_id, full_name, email, title)
     VALUES ($1::uuid, $2::uuid, $3, $4, 'Patient') RETURNING contact_id`,
    [
      input.tenantId,
      accountId,
      `Patient ${input.subject}`,
      input.hasEmail ? `patient-${caseId}@example.test` : null,
    ],
  )).rows[0].contact_id as string;

  await c.query(
    `INSERT INTO platform.crm_cases (
       case_id, tenant_id, account_id, contact_id, subject, priority, status,
       blueprint_key, stage_key, owner_subject_id, attributes,
       attributes_schema_version, industry_pack_vertical_key,
       industry_pack_version, industry_pack_runtime_source
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
       'NORMAL', 'RESOLVED', 'crm.case', 'RESOLVED', 'runner-reviewer',
       '{"urgency":"Routine","procedureCode":"D3310"}'::jsonb,
       1, 'dentex', NULL, 'CODE_BASELINE'
     )`,
    [caseId, input.tenantId, accountId, contactId, input.subject],
  );

  const appended = await appendCrmCaseLifecycleEvent(c, {
    tenantId: input.tenantId,
    caseId,
    workflowInstanceId: randomUUID(),
    fromStageKey: 'REVIEW',
    toStageKey: 'RESOLVED',
    actorSubjectId: 'runner-reviewer',
    correlationId: `runner-${caseId}`,
    provenance: {
      verticalKey: 'dentex',
      version: null,
      runtimeSource: 'CODE_BASELINE',
    },
    occurredAt: new Date('2026-08-30T15:30:00.000Z'),
  });
  assert.ok(appended);
  await setFixtureOutboxAvailableAt(c, input.tenantId, appended.outboxId, new Date('2026-08-30T15:30:00.000Z'));
  return appended.event.eventId;
}

test('bounded runner processes up to limit and returns metrics', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = await seedTenant(c);
    const first = await seedCaseEvent(c, { tenantId, hasEmail: true, subject: 'A' });
    const second = await seedCaseEvent(c, { tenantId, hasEmail: true, subject: 'B' });
    const third = await seedCaseEvent(c, { tenantId, hasEmail: false, subject: 'C' });

    const limited = await runDomainEventActionWorkerBatch(c, {
      tenantId,
      limit: 2,
      now: () => new Date('2026-08-30T15:31:00.000Z'),
    });

    assert.equal(limited.processed, 2);
    assert.equal(limited.published, 2);
    assert.equal(limited.failed, 0);
    assert.equal(limited.idle, false);
    assert.deepEqual(limited.items.map((item) => item.status), ['PUBLISHED', 'PUBLISHED']);
    assert.deepEqual(limited.items.map((item) => item.eventId), [first, second]);

    const remaining = await runDomainEventActionWorkerBatch(c, {
      tenantId,
      limit: 5,
      now: () => new Date('2026-08-30T15:32:00.000Z'),
      maxAttempts: 2,
    });

    assert.equal(remaining.processed, 1);
    assert.equal(remaining.published, 0);
    assert.equal(remaining.failed, 1);
    assert.equal(remaining.idle, true);
    assert.equal(remaining.errors.length, 1);
    assert.equal(remaining.items[0]?.eventId, third);
    assert.equal(remaining.items[0]?.status, 'FAILED');
    assert.equal(remaining.items[1]?.status, 'IDLE');

    const rows = await c.query(
      `SELECT status, count(*)::int AS count
         FROM platform.domain_event_outbox
        WHERE tenant_id = $1::uuid
        GROUP BY status
        ORDER BY status`,
      [tenantId],
    );
    assert.deepEqual(rows.rows, [
      { status: 'FAILED', count: 1 },
      { status: 'PUBLISHED', count: 2 },
    ]);
  } finally {
    c.release();
    await p.end();
  }
});

test('runner rejects invalid limits before touching the outbox', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = await seedTenant(c);
    await assert.rejects(
      () => runDomainEventActionWorkerBatch(c, { tenantId, limit: 0 }),
      /DOMAIN_EVENT_ACTION_RUNNER_LIMIT_MUST_BE_POSITIVE_INTEGER/,
    );
  } finally {
    c.release();
    await p.end();
  }
});
