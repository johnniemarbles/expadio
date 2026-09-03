import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { appendDomainEventWithOutbox } from '@expadio/postgres-runtime/domain-events';
import { grantTenantModuleEntitlement } from '@expadio/postgres-runtime/product-module';
import { activateSimpleProductModule } from '@expadio/postgres-runtime/simple-product-module-activation';
import { processOneDomainEventActionWorkItem, type DomainEventActionWorkerResult } from '../lib/domain-event-action-worker';
import { loadExecutionTraceForEvent } from '../lib/execution-trace';

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

async function processUntilEvent(
  client: pg.PoolClient,
  input: { tenantId: string; eventId: string; now: Date },
): Promise<Extract<DomainEventActionWorkerResult, { status: 'PUBLISHED' }>> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await processOneDomainEventActionWorkItem(client, {
      tenantId: input.tenantId,
      now: () => input.now,
    });
    if (result.status === 'IDLE') throw new Error('Target Demand Capture event was not claimed.');
    if (result.status !== 'PUBLISHED') {
      throw new Error(`Worker did not publish event: ${result.status}:${result.reason}`);
    }
    if (result.claim.eventId === input.eventId) return result;
  }
  throw new Error('Target Demand Capture event was not processed within bounded worker iterations.');
}

test('UNASSIGNED Demand Capture event becomes one governed operational task', async () => {
  const p = pool();
  const client = await p.connect();
  const tenantId = randomUUID();
  const captureLeadId = randomUUID();
  const organizationId = randomUUID();
  const sourceId = randomUUID();
  const actorSubjectId = `routing_actor_${randomUUID()}`;
  const eventId = randomUUID();

  try {
    await client.query(
      `INSERT INTO platform.tenants (tenant_id,name)
       VALUES ($1::uuid,'Demand Capture task integration tenant')`,
      [tenantId],
    );
    await client.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantId]);

    await client.query('BEGIN');
    await grantTenantModuleEntitlement(client, {
      tenantId,
      moduleKey: 'lead-management',
      sourceType: 'PLATFORM_GRANT',
      sourceKey: 'itest-demand-capture-task',
      validFrom: new Date(Date.now() - 1_000),
      validUntil: new Date(Date.now() + 10 * 60_000),
      metadata: { purpose: 'Demand Capture unassigned task integration proof' },
      actorSubjectId: 'platform-admin-itest',
      correlationId: randomUUID(),
    });
    await client.query('COMMIT');

    await client.query('BEGIN');
    await activateSimpleProductModule(client, {
      tenantId,
      moduleKey: 'lead-management',
      actorSubjectId: 'platform-admin-itest',
      correlationId: randomUUID(),
    });
    await client.query('COMMIT');

    const occurredAt = new Date();
    await client.query('BEGIN');
    await appendDomainEventWithOutbox(client, {
      event: {
        eventId,
        tenantId,
        aggregateType: 'lead.capture',
        aggregateId: captureLeadId,
        eventType: 'LeadCapture.RoutingUnassigned',
        eventVersion: 1,
        occurredAt,
        recordedAt: occurredAt,
        actorSubjectId,
        correlationId: `lead-capture:${captureLeadId}:routing`,
        causationId: randomUUID(),
        packKey: null,
        packVersion: null,
        payload: {
          captureLeadId,
          organizationId,
          sourceId,
          previousOwnerSubjectId: null,
          reasonCode: 'NO_VALID_ROUTE',
          explanation: 'No matching routing rule had an active assignee authorized for this organization.',
        },
        metadata: { source: 'lead.capture.routing' },
      },
    });
    await client.query('COMMIT');

    const result = await processUntilEvent(client, {
      tenantId,
      eventId,
      now: new Date(Date.now() + 60_000),
    });
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0]?.status, 'PERSISTED');
    if (result.actions[0]?.status !== 'PERSISTED') throw new Error('expected persisted action');
    assert.equal(result.actions[0].intent.executorClass, 'CREATE_TASK');
    assert.equal(result.actions[0].intent.actionKey, 'lead.capture.routing.resolve_unassigned');
    assert.equal(result.tasks.length, 1);
    assert.equal(result.communications.length, 0);
    assert.equal(result.schedules.length, 0);

    const executed = result.tasks[0];
    assert.ok(executed);
    assert.equal(executed.replayed, false);
    assert.equal(executed.attempt.status, 'SUCCEEDED');
    assert.ok(executed.task);
    assert.equal(executed.task.sourceEventId, eventId);
    assert.equal(executed.task.aggregateType, 'lead.capture');
    assert.equal(executed.task.aggregateId, captureLeadId);
    assert.equal(executed.task.title, 'Route unassigned Demand Capture lead');
    assert.equal(executed.task.assigneeSubjectId, null);
    assert.equal(executed.task.priority, 'HIGH');
    assert.equal(executed.task.status, 'OPEN');

    const persisted = (await client.query(
      `SELECT
         (SELECT count(*)::int FROM platform.governed_action_intents
           WHERE tenant_id=$1::uuid AND source_event_id=$2::uuid) AS intents,
         (SELECT count(*)::int FROM platform.operational_tasks
           WHERE tenant_id=$1::uuid AND source_event_id=$2::uuid) AS tasks,
         (SELECT status FROM platform.domain_event_outbox
           WHERE tenant_id=$1::uuid AND event_id=$2::uuid) AS outbox_status`,
      [tenantId, eventId],
    )).rows[0];
    assert.deepEqual(persisted, { intents: 1, tasks: 1, outbox_status: 'PUBLISHED' });

    const trace = await loadExecutionTraceForEvent(client, { tenantId, eventId });
    assert.ok(trace);
    assert.equal(trace.event.eventType, 'LeadCapture.RoutingUnassigned');
    assert.equal(trace.actions.length, 1);
    assert.equal(trace.actions[0]?.executorClass, 'CREATE_TASK');
    assert.equal(trace.tasks.length, 1);
    assert.equal(trace.tasks[0]?.priority, 'HIGH');
  } finally {
    try { await client.query('ROLLBACK'); } catch {}
    client.release();
    await p.end();
  }
});
