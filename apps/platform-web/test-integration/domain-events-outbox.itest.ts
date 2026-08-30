import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  appendDomainEventWithOutbox,
  loadDomainEvent,
} from '@expadio/postgres-runtime/domain-events';

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

test('business mutation + Domain Event + outbox commit atomically and roll back atomically', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const accountId = randomUUID();
    const actor = `${tenantId.slice(0, 8)}-operator`;
    const eventId = randomUUID();
    const rollbackEventId = randomUUID();
    const correlationId = randomUUID();

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Domain event tenant', 'dentex')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    await c.query(
      `INSERT INTO platform.crm_accounts (
         account_id, tenant_id, name, lifecycle_stage
       ) VALUES ($1::uuid, $2::uuid, 'Event Practice', 'PROSPECT')`,
      [accountId, tenantId],
    );

    await c.query('BEGIN');
    try {
      await c.query(
        `UPDATE platform.crm_accounts
            SET lifecycle_stage = 'CUSTOMER',
                updated_at = now()
          WHERE account_id = $1::uuid`,
        [accountId],
      );

      const appended = await appendDomainEventWithOutbox(c, {
        event: {
          eventId,
          tenantId,
          aggregateType: 'crm.account',
          aggregateId: accountId,
          eventType: 'Account.BecameCustomer',
          eventVersion: 1,
          occurredAt: new Date(),
          actorSubjectId: actor,
          correlationId,
          causationId: 'lead-conversion',
          packKey: 'dentex',
          payload: {
            previousLifecycleStage: 'PROSPECT',
            lifecycleStage: 'CUSTOMER',
          },
          metadata: {
            source: 'integration-test',
          },
        },
      });

      assert.equal(appended.topic, 'domain.events');
      assert.equal(appended.partitionKey, `crm.account:${accountId}`);
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    }

    const persisted = (await c.query(
      `SELECT
         account.lifecycle_stage,
         event.event_type,
         event.aggregate_type,
         event.aggregate_id,
         event.correlation_id,
         event.causation_id,
         event.pack_key,
         event.pack_version,
         event.payload,
         outbox.status AS outbox_status,
         outbox.attempts,
         outbox.topic,
         outbox.partition_key
       FROM platform.crm_accounts account
       JOIN platform.domain_events event
         ON event.tenant_id = account.tenant_id
        AND event.event_id = $2::uuid
       JOIN platform.domain_event_outbox outbox
         ON outbox.tenant_id = event.tenant_id
        AND outbox.event_id = event.event_id
      WHERE account.tenant_id = $1::uuid
        AND account.account_id = $3::uuid`,
      [tenantId, eventId, accountId],
    )).rows[0];

    assert.deepEqual(persisted, {
      lifecycle_stage: 'CUSTOMER',
      event_type: 'Account.BecameCustomer',
      aggregate_type: 'crm.account',
      aggregate_id: accountId,
      correlation_id: correlationId,
      causation_id: 'lead-conversion',
      pack_key: 'dentex',
      pack_version: null,
      payload: {
        lifecycleStage: 'CUSTOMER',
        previousLifecycleStage: 'PROSPECT',
      },
      outbox_status: 'PENDING',
      attempts: 0,
      topic: 'domain.events',
      partition_key: `crm.account:${accountId}`,
    });

    const loaded = await loadDomainEvent(c, { tenantId, eventId });
    assert.ok(loaded);
    assert.equal(loaded.eventType, 'Account.BecameCustomer');
    assert.equal(loaded.aggregateId, accountId);

    await c.query('BEGIN');
    try {
      await c.query(
        `UPDATE platform.crm_accounts
            SET lifecycle_stage = 'CHURNED',
                updated_at = now()
          WHERE account_id = $1::uuid`,
        [accountId],
      );

      await appendDomainEventWithOutbox(c, {
        event: {
          eventId: rollbackEventId,
          tenantId,
          aggregateType: 'crm.account',
          aggregateId: accountId,
          eventType: 'Account.Churned',
          eventVersion: 1,
          occurredAt: new Date(),
          actorSubjectId: actor,
          correlationId: randomUUID(),
          causationId: eventId,
          packKey: 'dentex',
          payload: { lifecycleStage: 'CHURNED' },
        },
      });

      await c.query('ROLLBACK');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    }

    const afterRollback = (await c.query(
      `SELECT
         (SELECT lifecycle_stage
            FROM platform.crm_accounts
           WHERE tenant_id = $1::uuid
             AND account_id = $2::uuid) AS lifecycle_stage,
         (SELECT count(*)::int
            FROM platform.domain_events
           WHERE tenant_id = $1::uuid
             AND event_id = $3::uuid) AS rolled_back_events,
         (SELECT count(*)::int
            FROM platform.domain_event_outbox
           WHERE tenant_id = $1::uuid
             AND event_id = $3::uuid) AS rolled_back_outbox`,
      [tenantId, accountId, rollbackEventId],
    )).rows[0];

    assert.deepEqual(afterRollback, {
      lifecycle_stage: 'CUSTOMER',
      rolled_back_events: 0,
      rolled_back_outbox: 0,
    });

    await assert.rejects(
      () => c.query(
        `UPDATE platform.domain_events
            SET payload = '{"tampered":true}'::jsonb
          WHERE tenant_id = $1::uuid
            AND event_id = $2::uuid`,
        [tenantId, eventId],
      ),
      /domain events are append-only/,
    );

    await assert.rejects(
      () => appendDomainEventWithOutbox(c, {
        event: {
          eventId,
          tenantId,
          aggregateType: 'crm.account',
          aggregateId: accountId,
          eventType: 'Account.Duplicate',
          eventVersion: 1,
          occurredAt: new Date(),
          actorSubjectId: actor,
          correlationId: randomUUID(),
        },
      }),
      /DOMAIN_EVENT_DUPLICATE/,
    );
  } finally {
    c.release();
    await p.end();
  }
});
