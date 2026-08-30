import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { appendDomainEventWithOutbox } from '@expadio/postgres-runtime/domain-events';
import {
  claimDomainEventOutbox,
  completeDomainEventOutbox,
  failDomainEventOutbox,
} from '@expadio/postgres-runtime/domain-event-outbox-worker';

function pool(max = 2): pg.Pool {
  return new pg.Pool({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    database: process.env.PGDATABASE ?? 'expadio_test',
    max,
  });
}

async function tenant(client: pg.PoolClient): Promise<string> {
  const tenantId = randomUUID();
  await client.query(
    `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
     VALUES ($1::uuid, 'Outbox worker tenant', 'dentex')`,
    [tenantId],
  );
  await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
  return tenantId;
}

async function event(client: pg.PoolClient, tenantId: string, eventType = 'Treatment.Discharged') {
  return appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId,
      aggregateType: 'crm.case',
      aggregateId: randomUUID(),
      eventType,
      eventVersion: 1,
      occurredAt: new Date('2026-08-30T14:00:00.000Z'),
      actorSubjectId: 'worker-itest',
      correlationId: randomUUID(),
      packKey: 'dentex',
      payload: {},
    },
  });
}

test('two workers cannot claim the same available event', async () => {
  const p = pool(2);
  const c1 = await p.connect();
  const c2 = await p.connect();
  try {
    const tenantId = await tenant(c1);
    await c2.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    const appended = await event(c1, tenantId);
    const now = new Date(Date.now() + 60_000);

    const [first, second] = await Promise.all([
      claimDomainEventOutbox(c1, { tenantId, now }),
      claimDomainEventOutbox(c2, { tenantId, now }),
    ]);
    const claims = [first, second].filter((value) => value !== null);
    assert.equal(claims.length, 1);
    assert.equal(claims[0]?.eventId, appended.event.eventId);
    assert.equal(claims[0]?.attempts, 1);
  } finally {
    c1.release();
    c2.release();
    await p.end();
  }
});

test('failed work retries after available_at and stale claim tokens cannot complete', async () => {
  const p = pool(1);
  const c = await p.connect();
  try {
    const tenantId = await tenant(c);
    await event(c, tenantId);
    const firstAt = new Date(Date.now() + 60_000);
    const first = await claimDomainEventOutbox(c, { tenantId, now: firstAt });
    assert.ok(first);

    const retryAt = new Date(firstAt.getTime() + 120_000);
    assert.equal(await failDomainEventOutbox(c, {
      tenantId,
      outboxId: first.outboxId,
      claimedAt: first.claimedAt,
      error: 'temporary action runtime failure',
      failedAt: new Date(firstAt.getTime() + 30_000),
      retryAt,
    }), 'FAILED');

    assert.equal(await claimDomainEventOutbox(c, {
      tenantId,
      now: new Date(firstAt.getTime() + 60_000),
    }), null);

    const second = await claimDomainEventOutbox(c, { tenantId, now: retryAt });
    assert.ok(second);
    assert.equal(second.attempts, 2);
    assert.equal(await completeDomainEventOutbox(c, {
      tenantId,
      outboxId: second.outboxId,
      claimedAt: first.claimedAt,
      completedAt: new Date(retryAt.getTime() + 10_000),
    }), false);
    assert.equal(await completeDomainEventOutbox(c, {
      tenantId,
      outboxId: second.outboxId,
      claimedAt: second.claimedAt,
      completedAt: new Date(retryAt.getTime() + 10_000),
    }), true);

    const row = (await c.query(
      `SELECT status, attempts, published_at IS NOT NULL AS published
         FROM platform.domain_event_outbox
        WHERE tenant_id = $1::uuid AND outbox_id = $2::uuid`,
      [tenantId, second.outboxId],
    )).rows[0];
    assert.deepEqual(row, { status: 'PUBLISHED', attempts: 2, published: true });
  } finally {
    c.release();
    await p.end();
  }
});

test('expired claims are recovered and max attempts terminate as DEAD', async () => {
  const p = pool(1);
  const c = await p.connect();
  try {
    const tenantId = await tenant(c);
    await event(c, tenantId);
    const firstAt = new Date(Date.now() + 60_000);
    const first = await claimDomainEventOutbox(c, {
      tenantId,
      now: firstAt,
      leaseMs: 60_000,
      maxAttempts: 2,
    });
    assert.ok(first);

    const recovered = await claimDomainEventOutbox(c, {
      tenantId,
      now: new Date(firstAt.getTime() + 120_000),
      leaseMs: 60_000,
      maxAttempts: 2,
    });
    assert.ok(recovered);
    assert.equal(recovered.outboxId, first.outboxId);
    assert.equal(recovered.attempts, 2);

    assert.equal(await failDomainEventOutbox(c, {
      tenantId,
      outboxId: recovered.outboxId,
      claimedAt: recovered.claimedAt,
      error: 'permanent failure',
      failedAt: new Date(firstAt.getTime() + 130_000),
      maxAttempts: 2,
    }), 'DEAD');

    assert.equal(await claimDomainEventOutbox(c, {
      tenantId,
      now: new Date(firstAt.getTime() + 3_600_000),
      maxAttempts: 2,
    }), null);
  } finally {
    c.release();
    await p.end();
  }
});


test('a crash on the final allowed attempt is swept to DEAD after lease expiry', async () => {
  const p = pool(1);
  const c = await p.connect();
  try {
    const tenantId = await tenant(c);
    await event(c, tenantId);
    const firstAt = new Date(Date.now() + 60_000);
    const first = await claimDomainEventOutbox(c, {
      tenantId,
      now: firstAt,
      leaseMs: 60_000,
      maxAttempts: 1,
    });
    assert.ok(first);
    assert.equal(first.attempts, 1);

    assert.equal(await claimDomainEventOutbox(c, {
      tenantId,
      now: new Date(firstAt.getTime() + 120_000),
      leaseMs: 60_000,
      maxAttempts: 1,
    }), null);

    const row = (await c.query(
      `SELECT status, claimed_at
         FROM platform.domain_event_outbox
        WHERE tenant_id = $1::uuid AND outbox_id = $2::uuid`,
      [tenantId, first.outboxId],
    )).rows[0];
    assert.equal(row.status, 'DEAD');
    assert.equal(row.claimed_at, null);
  } finally {
    c.release();
    await p.end();
  }
});

test('an expired lease cannot complete or fail even before another worker reclaims it', async () => {
  const p = pool(1);
  const c = await p.connect();
  try {
    const tenantId = await tenant(c);
    await event(c, tenantId);
    const firstAt = new Date(Date.now() + 60_000);
    const claim = await claimDomainEventOutbox(c, {
      tenantId,
      now: firstAt,
      leaseMs: 60_000,
    });
    assert.ok(claim);

    assert.equal(await completeDomainEventOutbox(c, {
      tenantId,
      outboxId: claim.outboxId,
      claimedAt: claim.claimedAt,
      completedAt: new Date(firstAt.getTime() + 120_000),
      leaseMs: 60_000,
    }), false);

    assert.equal(await failDomainEventOutbox(c, {
      tenantId,
      outboxId: claim.outboxId,
      claimedAt: claim.claimedAt,
      error: 'stale worker must not mutate',
      failedAt: new Date(firstAt.getTime() + 120_000),
      leaseMs: 60_000,
    }), 'STALE_CLAIM');

    const recovered = await claimDomainEventOutbox(c, {
      tenantId,
      now: new Date(firstAt.getTime() + 120_000),
      leaseMs: 60_000,
    });
    assert.ok(recovered);
    assert.equal(recovered.outboxId, claim.outboxId);
    assert.equal(recovered.attempts, 2);
  } finally {
    c.release();
    await p.end();
  }
});

test('later events in one partition remain blocked until the earlier event is PUBLISHED', async () => {
  const p = pool(1);
  const c = await p.connect();
  try {
    const tenantId = await tenant(c);
    const aggregateId = randomUUID();
    const first = await appendDomainEventWithOutbox(c, {
      event: {
        eventId: randomUUID(),
        tenantId,
        aggregateType: 'crm.case',
        aggregateId,
        eventType: 'Treatment.ClinicalReviewEntered',
        eventVersion: 1,
        occurredAt: new Date('2026-08-30T19:00:00.000Z'),
        actorSubjectId: 'worker-itest',
        correlationId: randomUUID(),
        packKey: 'dentex',
        payload: {},
      },
    });
    const second = await appendDomainEventWithOutbox(c, {
      event: {
        eventId: randomUUID(),
        tenantId,
        aggregateType: 'crm.case',
        aggregateId,
        eventType: 'Treatment.Discharged',
        eventVersion: 1,
        occurredAt: new Date('2026-08-30T19:00:01.000Z'),
        actorSubjectId: 'worker-itest',
        correlationId: randomUUID(),
        packKey: 'dentex',
        payload: {},
      },
    });
    assert.equal(first.partitionKey, second.partitionKey);

    const firstAt = new Date(Date.now() + 60_000);
    const firstClaim = await claimDomainEventOutbox(c, {
      tenantId,
      now: firstAt,
    });
    assert.ok(firstClaim);
    assert.equal(firstClaim.eventId, first.event.eventId);

    assert.equal(await claimDomainEventOutbox(c, {
      tenantId,
      now: new Date(firstAt.getTime() + 10_000),
    }), null);

    assert.equal(await completeDomainEventOutbox(c, {
      tenantId,
      outboxId: firstClaim.outboxId,
      claimedAt: firstClaim.claimedAt,
      completedAt: new Date(firstAt.getTime() + 20_000),
    }), true);

    const secondClaim = await claimDomainEventOutbox(c, {
      tenantId,
      now: new Date(firstAt.getTime() + 21_000),
    });
    assert.ok(secondClaim);
    assert.equal(secondClaim.eventId, second.event.eventId);
  } finally {
    c.release();
    await p.end();
  }
});
