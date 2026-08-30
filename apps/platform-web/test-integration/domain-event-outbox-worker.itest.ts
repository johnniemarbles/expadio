import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  appendDomainEventWithOutbox,
} from '@expadio/postgres-runtime/domain-events';
import {
  claimDomainEventOutboxBatch,
  failDomainEventOutboxClaim,
  publishDomainEventOutboxClaim,
} from '@expadio/postgres-runtime/domain-event-outbox';
import {
  domainEventOutboxRetryDelaySeconds,
  runDomainEventOutboxBatch,
} from '@expadio/postgres-runtime/domain-event-outbox-runner';

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

async function appendEvent(
  client: pg.PoolClient,
  input: {
    tenantId: string;
    aggregateId?: string;
    eventType?: string;
    occurredAt?: Date;
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
        occurredAt: input.occurredAt ?? new Date('2026-08-30T14:00:00.000Z'),
        actorSubjectId: 'worker-itest',
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

test('concurrent workers claim disjoint outbox rows with SKIP LOCKED', async () => {
  const p = pool();
  const setup = await p.connect();
  const w1 = await p.connect();
  const w2 = await p.connect();
  try {
    const tenantId = randomUUID();
    await setup.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Outbox concurrency tenant', 'dentex')`,
      [tenantId],
    );
    await Promise.all([
      bindTenant(setup, tenantId),
      bindTenant(w1, tenantId),
      bindTenant(w2, tenantId),
    ]);

    for (let i = 0; i < 4; i += 1) {
      await appendEvent(setup, { tenantId });
    }

    const now = new Date('2026-08-30T14:01:00.000Z');
    const [a, b] = await Promise.all([
      claimDomainEventOutboxBatch(w1, {
        tenantId,
        batchSize: 2,
        leaseSeconds: 60,
        maxAttempts: 4,
        now,
      }),
      claimDomainEventOutboxBatch(w2, {
        tenantId,
        batchSize: 2,
        leaseSeconds: 60,
        maxAttempts: 4,
        now,
      }),
    ]);

    assert.equal(a.length, 2);
    assert.equal(b.length, 2);

    const ids = [...a, ...b].map((item) => item.outboxId);
    assert.equal(new Set(ids).size, 4);
    assert.ok([...a, ...b].every((item) => item.attempts === 1));
    assert.ok([...a, ...b].every((item) => item.event.eventType === 'Treatment.Discharged'));
  } finally {
    setup.release();
    w1.release();
    w2.release();
    await p.end();
  }
});

test('expired lease is reclaimable and stale token cannot acknowledge', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Outbox lease tenant', 'dentex')`,
      [tenantId],
    );
    await bindTenant(c, tenantId);
    await appendEvent(c, { tenantId });

    const first = await claimDomainEventOutboxBatch(c, {
      tenantId,
      batchSize: 1,
      leaseSeconds: 10,
      maxAttempts: 3,
      now: new Date('2026-08-30T14:10:00.000Z'),
    });
    assert.equal(first.length, 1);

    const reclaimed = await claimDomainEventOutboxBatch(c, {
      tenantId,
      batchSize: 1,
      leaseSeconds: 10,
      maxAttempts: 3,
      now: new Date('2026-08-30T14:10:11.000Z'),
    });
    assert.equal(reclaimed.length, 1);
    assert.equal(reclaimed[0]?.outboxId, first[0]?.outboxId);
    assert.equal(reclaimed[0]?.attempts, 2);
    assert.notEqual(reclaimed[0]?.claimToken, first[0]?.claimToken);

    await assert.rejects(
      () => publishDomainEventOutboxClaim(c, {
        tenantId,
        outboxId: first[0]!.outboxId,
        claimToken: first[0]!.claimToken,
        publishedAt: new Date('2026-08-30T14:10:12.000Z'),
      }),
      /DOMAIN_EVENT_OUTBOX_CLAIM_LOST/,
    );

    await publishDomainEventOutboxClaim(c, {
      tenantId,
      outboxId: reclaimed[0]!.outboxId,
      claimToken: reclaimed[0]!.claimToken,
      publishedAt: new Date('2026-08-30T14:10:12.000Z'),
    });

    const row = (await c.query(
      `SELECT status, attempts, claim_token, claim_expires_at, published_at
         FROM platform.domain_event_outbox
        WHERE tenant_id = $1::uuid`,
      [tenantId],
    )).rows[0];

    assert.equal(row.status, 'PUBLISHED');
    assert.equal(row.attempts, 2);
    assert.equal(row.claim_token, null);
    assert.equal(row.claim_expires_at, null);
    assert.ok(row.published_at);
  } finally {
    c.release();
    await p.end();
  }
});

test('failed work waits until available_at and final failure becomes DEAD', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Outbox retry tenant', 'dentex')`,
      [tenantId],
    );
    await bindTenant(c, tenantId);
    await appendEvent(c, { tenantId });

    const first = await claimDomainEventOutboxBatch(c, {
      tenantId,
      batchSize: 1,
      leaseSeconds: 30,
      maxAttempts: 2,
      now: new Date('2026-08-30T14:20:00.000Z'),
    });
    assert.equal(first.length, 1);

    const firstState = await failDomainEventOutboxClaim(c, {
      tenantId,
      outboxId: first[0]!.outboxId,
      claimToken: first[0]!.claimToken,
      attempts: first[0]!.attempts,
      error: 'temporary downstream error',
      maxAttempts: 2,
      retryDelaySeconds: 30,
      failedAt: new Date('2026-08-30T14:20:01.000Z'),
    });
    assert.equal(firstState, 'FAILED');

    const tooEarly = await claimDomainEventOutboxBatch(c, {
      tenantId,
      batchSize: 1,
      leaseSeconds: 30,
      maxAttempts: 2,
      now: new Date('2026-08-30T14:20:20.000Z'),
    });
    assert.equal(tooEarly.length, 0);

    const second = await claimDomainEventOutboxBatch(c, {
      tenantId,
      batchSize: 1,
      leaseSeconds: 30,
      maxAttempts: 2,
      now: new Date('2026-08-30T14:20:32.000Z'),
    });
    assert.equal(second.length, 1);
    assert.equal(second[0]?.attempts, 2);

    const finalState = await failDomainEventOutboxClaim(c, {
      tenantId,
      outboxId: second[0]!.outboxId,
      claimToken: second[0]!.claimToken,
      attempts: second[0]!.attempts,
      error: 'still failing',
      maxAttempts: 2,
      retryDelaySeconds: 30,
      failedAt: new Date('2026-08-30T14:20:33.000Z'),
    });
    assert.equal(finalState, 'DEAD');

    const row = (await c.query(
      `SELECT status, attempts, last_error
         FROM platform.domain_event_outbox
        WHERE tenant_id = $1::uuid`,
      [tenantId],
    )).rows[0];
    assert.deepEqual(row, {
      status: 'DEAD',
      attempts: 2,
      last_error: 'still failing',
    });
  } finally {
    c.release();
    await p.end();
  }
});

test('generic batch runner publishes successes and retries failures independently', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Outbox runner tenant', 'dentex')`,
      [tenantId],
    );
    await bindTenant(c, tenantId);

    await appendEvent(c, { tenantId, eventType: 'Treatment.Discharged' });
    await appendEvent(c, { tenantId, eventType: 'Treatment.ClinicalReviewEntered' });

    const times = [
      new Date('2026-08-30T14:30:00.000Z'),
      new Date('2026-08-30T14:30:01.000Z'),
      new Date('2026-08-30T14:30:02.000Z'),
    ];
    let clockIndex = 0;

    const result = await runDomainEventOutboxBatch(c, {
      tenantId,
      batchSize: 10,
      leaseSeconds: 60,
      maxAttempts: 3,
      baseRetryDelaySeconds: 10,
      maxRetryDelaySeconds: 60,
      now: () => times[Math.min(clockIndex++, times.length - 1)]!,
      publisher: {
        async publish({ item }) {
          if (item.event.eventType === 'Treatment.ClinicalReviewEntered') {
            throw new Error('review consumer unavailable');
          }
        },
      },
    });

    assert.deepEqual(result, {
      claimed: 2,
      published: 1,
      failed: 1,
      dead: 0,
      claimLost: 0,
    });

    const states = (await c.query(
      `SELECT event.event_type, outbox.status, outbox.attempts, outbox.last_error
         FROM platform.domain_event_outbox outbox
         JOIN platform.domain_events event
           ON event.tenant_id = outbox.tenant_id
          AND event.event_id = outbox.event_id
        WHERE outbox.tenant_id = $1::uuid
        ORDER BY event.event_type`,
      [tenantId],
    )).rows;

    assert.deepEqual(states, [
      {
        event_type: 'Treatment.ClinicalReviewEntered',
        status: 'FAILED',
        attempts: 1,
        last_error: 'review consumer unavailable',
      },
      {
        event_type: 'Treatment.Discharged',
        status: 'PUBLISHED',
        attempts: 1,
        last_error: null,
      },
    ]);

    assert.equal(domainEventOutboxRetryDelaySeconds({ attempts: 1 }), 15);
    assert.equal(domainEventOutboxRetryDelaySeconds({ attempts: 2 }), 30);
    assert.equal(domainEventOutboxRetryDelaySeconds({ attempts: 20 }), 900);
  } finally {
    c.release();
    await p.end();
  }
});
