import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  acquireTenantExecutionLease,
  finishTenantExecutionRun,
} from '../lib/domain-event-tenant-execution';

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

test('tenant execution lease blocks overlap and expired runs become LEASE_LOST', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Execution lease tenant', 'dentex')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    const first = await acquireTenantExecutionLease(c, {
      tenantId,
      invocationId: randomUUID(),
      requestedLimit: 10,
      now: new Date('2026-08-30T20:00:00.000Z'),
      leaseMs: 60_000,
    });
    assert.equal(first.acquired, true);
    if (!first.acquired) throw new Error('first lease was not acquired');

    const busy = await acquireTenantExecutionLease(c, {
      tenantId,
      invocationId: randomUUID(),
      requestedLimit: 10,
      now: new Date('2026-08-30T20:00:30.000Z'),
      leaseMs: 60_000,
    });
    assert.deepEqual(
      busy.acquired ? null : [busy.reason, busy.activeRunId],
      ['BUSY', first.lease.runId],
    );

    assert.equal(await finishTenantExecutionRun(c, {
      lease: first.lease,
      summary: null,
      error: null,
      finishedAt: new Date('2026-08-30T20:01:30.000Z'),
    }), 'LEASE_LOST');

    const recovered = await acquireTenantExecutionLease(c, {
      tenantId,
      invocationId: randomUUID(),
      requestedLimit: 10,
      now: new Date('2026-08-30T20:02:00.000Z'),
      leaseMs: 60_000,
    });
    assert.equal(recovered.acquired, true);
    if (!recovered.acquired) throw new Error('expired lease was not recovered');

    const abandoned = (await c.query(
      `SELECT status, finished_at IS NOT NULL AS finished,
              error
         FROM platform.domain_event_tenant_execution_runs
        WHERE tenant_id = $1::uuid
          AND run_id = $2::uuid`,
      [tenantId, first.lease.runId],
    )).rows[0];
    assert.deepEqual(abandoned, {
      status: 'LEASE_LOST',
      finished: true,
      error: 'TENANT_EXECUTION_LEASE_EXPIRED',
    });

    const terminal = await finishTenantExecutionRun(c, {
      lease: recovered.lease,
      summary: {
        tenantId,
        requestedLimit: 10,
        processed: 2,
        idle: true,
        published: 2,
        failed: 0,
        dead: 0,
        staleClaim: 0,
        errors: [],
        items: [],
      },
      error: null,
      finishedAt: new Date('2026-08-30T20:02:05.000Z'),
    });
    assert.equal(terminal, 'SUCCEEDED');

    const completed = (await c.query(
      `SELECT status, processed, published, duration_ms,
              finished_at IS NOT NULL AS finished
         FROM platform.domain_event_tenant_execution_runs
        WHERE tenant_id = $1::uuid
          AND run_id = $2::uuid`,
      [tenantId, recovered.lease.runId],
    )).rows[0];
    assert.deepEqual(completed, {
      status: 'SUCCEEDED',
      processed: 2,
      published: 2,
      duration_ms: '5000',
      finished: true,
    });

    const state = (await c.query(
      `SELECT current_run_id, lease_token, lease_expires_at,
              last_success_at IS NOT NULL AS succeeded
         FROM platform.domain_event_tenant_execution_state
        WHERE tenant_id = $1::uuid`,
      [tenantId],
    )).rows[0];
    assert.deepEqual(state, {
      current_run_id: null,
      lease_token: null,
      lease_expires_at: null,
      succeeded: true,
    });
  } finally {
    c.release();
    await p.end();
  }
});

test('disabled tenant execution state refuses a scheduler tick', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Disabled execution tenant', 'dentex')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    await c.query(
      `INSERT INTO platform.domain_event_tenant_execution_state (
         tenant_id, enabled
       ) VALUES ($1::uuid, false)`,
      [tenantId],
    );

    const result = await acquireTenantExecutionLease(c, {
      tenantId,
      invocationId: randomUUID(),
      requestedLimit: 5,
    });
    assert.deepEqual(result, {
      acquired: false,
      reason: 'DISABLED',
      activeRunId: null,
      leaseExpiresAt: null,
    });

    const runs = (await c.query(
      `SELECT count(*)::int AS count
         FROM platform.domain_event_tenant_execution_runs
        WHERE tenant_id = $1::uuid`,
      [tenantId],
    )).rows[0]?.count;
    assert.equal(runs, 0);
  } finally {
    c.release();
    await p.end();
  }
});
