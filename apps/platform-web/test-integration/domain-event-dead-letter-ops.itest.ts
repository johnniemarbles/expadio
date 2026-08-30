import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { appendDomainEventWithOutbox } from '@expadio/postgres-runtime/domain-events';
import {
  claimDomainEventOutbox,
  failDomainEventOutbox,
} from '@expadio/postgres-runtime/domain-event-outbox-worker';
import {
  loadDomainEventOperationById,
  requeueDeadDomainEvent,
} from '../lib/domain-event-operations';

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

test('DEAD Domain Event outbox can start a new audited retry cycle', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Dead letter tenant', 'dentex')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    const appended = await appendDomainEventWithOutbox(c, {
      event: {
        eventId: randomUUID(),
        tenantId,
        aggregateType: 'crm.case',
        aggregateId: randomUUID(),
        eventType: 'Treatment.Discharged',
        eventVersion: 1,
        occurredAt: new Date('2026-08-30T17:00:00.000Z'),
        actorSubjectId: 'dead-letter-itest',
        correlationId: randomUUID(),
        packKey: 'dentex',
        payload: {},
      },
    });

    const claim = await claimDomainEventOutbox(c, {
      tenantId,
      now: new Date('2026-08-30T17:01:00.000Z'),
      maxAttempts: 1,
    });
    assert.ok(claim);

    assert.equal(await failDomainEventOutbox(c, {
      tenantId,
      outboxId: claim.outboxId,
      claimedAt: claim.claimedAt,
      error: 'Permanent test failure',
      failedAt: new Date('2026-08-30T17:01:01.000Z'),
      maxAttempts: 1,
    }), 'DEAD');

    const dead = await loadDomainEventOperationById(c, {
      tenantId,
      outboxId: appended.outboxId,
    });
    assert.equal(dead?.status, 'DEAD');
    assert.equal(dead?.attempts, 1);
    assert.equal(dead?.lastError, 'Permanent test failure');

    await c.query('BEGIN');
    let requeued;
    try {
      requeued = await requeueDeadDomainEvent(c, {
        tenantId,
        outboxId: appended.outboxId,
        actorSubjectId: 'tenant-admin-1',
        actorRoleKey: 'TENANT_ADMIN',
        reason: 'Provider incident resolved; replay approved.',
        correlationId: randomUUID(),
        now: new Date('2026-08-30T17:05:00.000Z'),
      });
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    }

    assert.equal(requeued.item.status, 'PENDING');
    assert.equal(requeued.item.attempts, 0);
    assert.equal(requeued.item.lastError, null);
    assert.equal(requeued.previousAttempts, 1);

    const audit = (await c.query(
      `SELECT previous_status, previous_attempts, reason,
              authorized_by_subject_id, authorized_by_role_key,
              correlation_id, requeued_at
         FROM platform.domain_event_outbox_requeue_events
        WHERE tenant_id = $1::uuid
          AND outbox_id = $2::uuid`,
      [tenantId, appended.outboxId],
    )).rows[0];

    assert.equal(audit.previous_status, 'DEAD');
    assert.equal(audit.previous_attempts, 1);
    assert.equal(audit.reason, 'Provider incident resolved; replay approved.');
    assert.equal(audit.authorized_by_subject_id, 'tenant-admin-1');
    assert.equal(audit.authorized_by_role_key, 'TENANT_ADMIN');

    await assert.rejects(
      () => c.query(
        `UPDATE platform.domain_event_outbox_requeue_events
            SET reason = 'tampered'
          WHERE tenant_id = $1::uuid
            AND requeue_event_id = $2::uuid`,
        [tenantId, requeued.requeueEventId],
      ),
      /append-only/,
    );

    await c.query('BEGIN');
    try {
      await assert.rejects(
        () => requeueDeadDomainEvent(c, {
          tenantId,
          outboxId: appended.outboxId,
          actorSubjectId: 'tenant-admin-1',
          actorRoleKey: 'TENANT_ADMIN',
          reason: 'Duplicate replay.',
          correlationId: randomUUID(),
        }),
        /DOMAIN_EVENT_OUTBOX_NOT_DEAD/,
      );
      await c.query('ROLLBACK');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    }
  } finally {
    c.release();
    await p.end();
  }
});
