import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  appendDomainEventWithOutbox,
} from '@expadio/postgres-runtime/domain-events';
import {
  claimDomainEventInboxBatch,
  processDomainEventInboxClaim,
  receiveDomainEventInboxDelivery,
  failDomainEventInboxClaim,
} from '@expadio/postgres-runtime/domain-event-inbox';
import {
  runDomainEventInboxBatch,
} from '@expadio/postgres-runtime/domain-event-inbox-runner';

function pool(max = 4): pg.Pool {
  return new pg.Pool({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    database: process.env.PGDATABASE ?? 'expadio_test',
    max,
  });
}

async function bindTenant(client: pg.PoolClient, tenantId: string): Promise<void> {
  await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
}

async function seedTenant(client: pg.PoolClient, name: string): Promise<string> {
  const tenantId = randomUUID();
  await client.query(
    `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
     VALUES ($1::uuid, $2, 'dentex')`,
    [tenantId, name],
  );
  await bindTenant(client, tenantId);
  return tenantId;
}

async function appendEvent(
  client: pg.PoolClient,
  input: {
    readonly tenantId: string;
    readonly aggregateId?: string;
    readonly eventType?: string;
    readonly occurredAt?: Date;
  },
) {
  await client.query('BEGIN');
  try {
    const appended = await appendDomainEventWithOutbox(client, {
      event: {
        eventId: randomUUID(),
        tenantId: input.tenantId,
        aggregateType: 'crm.case',
        aggregateId: input.aggregateId ?? randomUUID(),
        eventType: input.eventType ?? 'Treatment.Discharged',
        eventVersion: 1,
        occurredAt: input.occurredAt ?? new Date('2026-08-30T15:00:00.000Z'),
        actorSubjectId: 'inbox-itest',
        correlationId: randomUUID(),
        packKey: 'dentex',
        payload: {},
      },
    });
    await client.query('COMMIT');
    return appended;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

test('duplicate transport delivery collapses per consumer while consumers remain independent', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = await seedTenant(c, 'Inbox idempotency tenant');
    const event = await appendEvent(c, { tenantId });

    const first = await receiveDomainEventInboxDelivery(c, {
      tenantId,
      consumerKey: 'governed-actions',
      eventId: event.event.eventId,
      topic: event.topic,
      partitionKey: event.partitionKey,
      receivedAt: new Date('2026-08-30T15:00:01.000Z'),
    });
    const replay = await receiveDomainEventInboxDelivery(c, {
      tenantId,
      consumerKey: 'governed-actions',
      eventId: event.event.eventId,
      topic: event.topic,
      partitionKey: event.partitionKey,
      receivedAt: new Date('2026-08-30T15:00:02.000Z'),
    });
    assert.equal(replay.inboxId, first.inboxId);

    const analytics = await receiveDomainEventInboxDelivery(c, {
      tenantId,
      consumerKey: 'analytics-projection',
      eventId: event.event.eventId,
      topic: event.topic,
      partitionKey: event.partitionKey,
    });
    assert.notEqual(analytics.inboxId, first.inboxId);

    const counts = (await c.query(
      `SELECT consumer_key, count(*)::int AS count
         FROM platform.domain_event_inbox
        WHERE tenant_id = $1::uuid
        GROUP BY consumer_key
        ORDER BY consumer_key`,
      [tenantId],
    )).rows;
    assert.deepEqual(counts, [
      { consumer_key: 'analytics-projection', count: 1 },
      { consumer_key: 'governed-actions', count: 1 },
    ]);

    await assert.rejects(
      () => receiveDomainEventInboxDelivery(c, {
        tenantId,
        consumerKey: 'governed-actions',
        eventId: event.event.eventId,
        topic: event.topic,
        partitionKey: 'different-partition',
      }),
      /DOMAIN_EVENT_INBOX_IDEMPOTENCY_COLLISION/,
    );
  } finally {
    c.release();
    await p.end();
  }
});

test('processing one consumer does not acknowledge another consumer', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = await seedTenant(c, 'Inbox independent consumers tenant');
    const event = await appendEvent(c, { tenantId });

    for (const consumerKey of ['governed-actions', 'analytics-projection']) {
      await receiveDomainEventInboxDelivery(c, {
        tenantId,
        consumerKey,
        eventId: event.event.eventId,
        topic: event.topic,
        partitionKey: event.partitionKey,
      });
    }

    const claimed = await claimDomainEventInboxBatch(c, {
      tenantId,
      consumerKey: 'governed-actions',
      batchSize: 10,
      leaseSeconds: 60,
      maxAttempts: 3,
      now: new Date('2026-08-30T15:10:00.000Z'),
    });
    assert.equal(claimed.length, 1);

    await processDomainEventInboxClaim(c, {
      tenantId,
      inboxId: claimed[0]!.inboxId,
      claimToken: claimed[0]!.claimToken,
      processedAt: new Date('2026-08-30T15:10:01.000Z'),
    });

    const states = (await c.query(
      `SELECT consumer_key, status
         FROM platform.domain_event_inbox
        WHERE tenant_id = $1::uuid
        ORDER BY consumer_key`,
      [tenantId],
    )).rows;
    assert.deepEqual(states, [
      { consumer_key: 'analytics-projection', status: 'PENDING' },
      { consumer_key: 'governed-actions', status: 'PROCESSED' },
    ]);
  } finally {
    c.release();
    await p.end();
  }
});

test('consumer partition ordering blocks later event until earlier event is processed', async () => {
  const p = pool();
  const c1 = await p.connect();
  const c2 = await p.connect();
  try {
    const tenantId = await seedTenant(c1, 'Inbox ordering tenant');
    await bindTenant(c2, tenantId);
    const aggregateId = randomUUID();

    const first = await appendEvent(c1, {
      tenantId,
      aggregateId,
      eventType: 'Treatment.ClinicalReviewEntered',
      occurredAt: new Date('2026-08-30T15:20:00.000Z'),
    });
    const second = await appendEvent(c1, {
      tenantId,
      aggregateId,
      eventType: 'Treatment.Discharged',
      occurredAt: new Date('2026-08-30T15:20:01.000Z'),
    });

    await receiveDomainEventInboxDelivery(c1, {
      tenantId,
      consumerKey: 'governed-actions',
      eventId: first.event.eventId,
      topic: first.topic,
      partitionKey: first.partitionKey,
      receivedAt: new Date('2026-08-30T15:20:02.000Z'),
    });
    await receiveDomainEventInboxDelivery(c1, {
      tenantId,
      consumerKey: 'governed-actions',
      eventId: second.event.eventId,
      topic: second.topic,
      partitionKey: second.partitionKey,
      receivedAt: new Date('2026-08-30T15:20:03.000Z'),
    });

    const now = new Date('2026-08-30T15:21:00.000Z');
    const [a, b] = await Promise.all([
      claimDomainEventInboxBatch(c1, {
        tenantId,
        consumerKey: 'governed-actions',
        batchSize: 10,
        leaseSeconds: 60,
        maxAttempts: 3,
        now,
      }),
      claimDomainEventInboxBatch(c2, {
        tenantId,
        consumerKey: 'governed-actions',
        batchSize: 10,
        leaseSeconds: 60,
        maxAttempts: 3,
        now,
      }),
    ]);

    const combined = [...a, ...b];
    assert.equal(combined.length, 1);
    assert.equal(combined[0]?.eventId, first.event.eventId);

    const owner = a.some((item) => item.inboxId === combined[0]!.inboxId) ? c1 : c2;
    await processDomainEventInboxClaim(owner, {
      tenantId,
      inboxId: combined[0]!.inboxId,
      claimToken: combined[0]!.claimToken,
      processedAt: new Date('2026-08-30T15:21:01.000Z'),
    });

    const later = await claimDomainEventInboxBatch(c1, {
      tenantId,
      consumerKey: 'governed-actions',
      batchSize: 10,
      leaseSeconds: 60,
      maxAttempts: 3,
      now: new Date('2026-08-30T15:21:02.000Z'),
    });
    assert.equal(later.length, 1);
    assert.equal(later[0]?.eventId, second.event.eventId);
  } finally {
    c1.release();
    c2.release();
    await p.end();
  }
});

test('consumer runner retries one failed event without affecting successful event', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = await seedTenant(c, 'Inbox runner tenant');
    const successEvent = await appendEvent(c, {
      tenantId,
      eventType: 'Treatment.Discharged',
    });
    const failedEvent = await appendEvent(c, {
      tenantId,
      eventType: 'Treatment.ClinicalReviewEntered',
    });

    for (const event of [successEvent, failedEvent]) {
      await receiveDomainEventInboxDelivery(c, {
        tenantId,
        consumerKey: 'governed-actions',
        eventId: event.event.eventId,
        topic: event.topic,
        partitionKey: event.partitionKey,
      });
    }

    const times = [
      new Date('2026-08-30T15:30:00.000Z'),
      new Date('2026-08-30T15:30:01.000Z'),
      new Date('2026-08-30T15:30:02.000Z'),
    ];
    let clock = 0;

    const result = await runDomainEventInboxBatch(c, {
      tenantId,
      consumerKey: 'governed-actions',
      batchSize: 10,
      leaseSeconds: 60,
      maxAttempts: 3,
      now: () => times[Math.min(clock++, times.length - 1)]!,
      consumer: {
        async consume({ item }) {
          if (item.event.eventType === 'Treatment.ClinicalReviewEntered') {
            throw new Error('temporary governed-action consumer failure');
          }
        },
      },
    });

    assert.deepEqual(result, {
      claimed: 2,
      processed: 1,
      failed: 1,
      dead: 0,
      claimLost: 0,
    });

    const states = (await c.query(
      `SELECT event.event_type, inbox.status, inbox.attempts, inbox.last_error
         FROM platform.domain_event_inbox inbox
         JOIN platform.domain_events event
           ON event.tenant_id = inbox.tenant_id
          AND event.event_id = inbox.event_id
        WHERE inbox.tenant_id = $1::uuid
          AND inbox.consumer_key = 'governed-actions'
        ORDER BY event.event_type`,
      [tenantId],
    )).rows;

    assert.deepEqual(states, [
      {
        event_type: 'Treatment.ClinicalReviewEntered',
        status: 'FAILED',
        attempts: 1,
        last_error: 'temporary governed-action consumer failure',
      },
      {
        event_type: 'Treatment.Discharged',
        status: 'PROCESSED',
        attempts: 1,
        last_error: null,
      },
    ]);
  } finally {
    c.release();
    await p.end();
  }
});

test('consumer failure uses persisted attempt count and dead-letters final attempt', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = await seedTenant(c, 'Inbox dead-letter tenant');
    const event = await appendEvent(c, { tenantId });
    await receiveDomainEventInboxDelivery(c, {
      tenantId,
      consumerKey: 'governed-actions',
      eventId: event.event.eventId,
      topic: event.topic,
      partitionKey: event.partitionKey,
    });

    const first = await claimDomainEventInboxBatch(c, {
      tenantId,
      consumerKey: 'governed-actions',
      batchSize: 1,
      leaseSeconds: 30,
      maxAttempts: 2,
      now: new Date('2026-08-30T15:40:00.000Z'),
    });
    assert.equal(first[0]?.attempts, 1);

    const failed = await failDomainEventInboxClaim(c, {
      tenantId,
      inboxId: first[0]!.inboxId,
      claimToken: first[0]!.claimToken,
      error: 'first failure',
      maxAttempts: 2,
      retryDelaySeconds: 10,
      failedAt: new Date('2026-08-30T15:40:01.000Z'),
    });
    assert.equal(failed, 'FAILED');

    const second = await claimDomainEventInboxBatch(c, {
      tenantId,
      consumerKey: 'governed-actions',
      batchSize: 1,
      leaseSeconds: 30,
      maxAttempts: 2,
      now: new Date('2026-08-30T15:40:12.000Z'),
    });
    assert.equal(second[0]?.attempts, 2);

    const dead = await failDomainEventInboxClaim(c, {
      tenantId,
      inboxId: second[0]!.inboxId,
      claimToken: second[0]!.claimToken,
      error: 'second failure',
      maxAttempts: 2,
      retryDelaySeconds: 10,
      failedAt: new Date('2026-08-30T15:40:13.000Z'),
    });
    assert.equal(dead, 'DEAD');
  } finally {
    c.release();
    await p.end();
  }
});
