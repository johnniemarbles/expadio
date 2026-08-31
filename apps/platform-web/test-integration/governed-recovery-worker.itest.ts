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
  claimNextGovernedRecoveryCommand,
  runGovernedRecoveryWorkerOnce,
} from '../lib/governed-recovery-worker';

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

async function createTenant(client: pg.PoolClient): Promise<string> {
  const tenantId = randomUUID();
  await client.query(
    `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
     VALUES ($1::uuid, 'Recovery worker tenant', 'dentex')`,
    [tenantId],
  );
  await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);
  return tenantId;
}

async function createDeadOutbox(client: pg.PoolClient, tenantId: string): Promise<string> {
  const appended = await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId,
      aggregateType: 'crm.case',
      aggregateId: randomUUID(),
      eventType: 'Treatment.Discharged',
      eventVersion: 1,
      occurredAt: new Date('2026-08-31T10:00:00.000Z'),
      actorSubjectId: 'recovery-itest',
      correlationId: randomUUID(),
      packKey: 'dentex',
      payload: {},
    },
  });

  const claimAt = new Date(Date.now() + 60_000);
  const claim = await claimDomainEventOutbox(client, {
    tenantId,
    now: claimAt,
    maxAttempts: 1,
  });
  assert.ok(claim);
  assert.equal(await failDomainEventOutbox(client, {
    tenantId,
    outboxId: claim.outboxId,
    claimedAt: claim.claimedAt,
    error: 'Injected permanent failure',
    failedAt: new Date(claimAt.getTime() + 1_000),
    maxAttempts: 1,
  }), 'DEAD');

  return appended.outboxId;
}

async function requestRetry(
  client: pg.PoolClient,
  input: { tenantId: string; targetId: string; idempotencyKey?: string },
): Promise<string> {
  const recoveryCommandId = randomUUID();
  const correlationId = randomUUID();
  await client.query(
    `INSERT INTO platform.governed_recovery_commands (
       recovery_command_id, tenant_id, idempotency_key, command_type,
       target_kind, target_id, reason, requested_by_subject_id,
       requested_by_role_key, correlation_id
     ) VALUES (
       $1::uuid, $2::uuid, $3, 'RETRY', 'DOMAIN_EVENT_OUTBOX',
       $4::uuid, 'Injected failure resolved; governed replay approved.',
       'tenant-admin-itest', 'TENANT_ADMIN', $5::uuid
     )`,
    [
      recoveryCommandId,
      input.tenantId,
      input.idempotencyKey ?? `retry:${input.targetId}`,
      input.targetId,
      correlationId,
    ],
  );
  await client.query(
    `INSERT INTO platform.governed_recovery_command_events (
       tenant_id, recovery_command_id, event_type, previous_status, new_status,
       actor_subject_id, actor_role_key, reason
     ) VALUES (
       $1::uuid, $2::uuid, 'COMMAND_REQUESTED', NULL, 'QUEUED',
       'tenant-admin-itest', 'TENANT_ADMIN', 'Governed retry requested.'
     )`,
    [input.tenantId, recoveryCommandId],
  );
  return recoveryCommandId;
}

test('governed recovery RETRY atomically requeues a DEAD outbox row with evidence', async () => {
  const p = pool(1);
  const c = await p.connect();
  try {
    const tenantId = await createTenant(c);
    const outboxId = await createDeadOutbox(c, tenantId);
    const recoveryCommandId = await requestRetry(c, { tenantId, targetId: outboxId });

    const result = await runGovernedRecoveryWorkerOnce(c, {
      tenantId,
      workerSubjectId: 'recovery-worker-itest',
      now: new Date(Date.now() + 300_000),
    });
    assert.deepEqual(result, {
      status: 'SUCCEEDED',
      recoveryCommandId,
      reasonCode: 'DOMAIN_EVENT_OUTBOX_REQUEUED',
    });

    const outbox = (await c.query(
      `SELECT status, attempts, claimed_at, published_at, last_error
         FROM platform.domain_event_outbox
        WHERE tenant_id = $1::uuid AND outbox_id = $2::uuid`,
      [tenantId, outboxId],
    )).rows[0];
    assert.equal(outbox.status, 'PENDING');
    assert.equal(outbox.attempts, 0);
    assert.equal(outbox.claimed_at, null);
    assert.equal(outbox.published_at, null);
    assert.equal(outbox.last_error, null);

    const command = (await c.query(
      `SELECT status, claim_token, claim_expires_at, processed_at, last_error
         FROM platform.governed_recovery_commands
        WHERE tenant_id = $1::uuid AND recovery_command_id = $2::uuid`,
      [tenantId, recoveryCommandId],
    )).rows[0];
    assert.equal(command.status, 'SUCCEEDED');
    assert.equal(command.claim_token, null);
    assert.equal(command.claim_expires_at, null);
    assert.ok(command.processed_at);
    assert.equal(command.last_error, null);

    const requeueCount = Number((await c.query(
      `SELECT count(*)::int AS count
         FROM platform.domain_event_outbox_requeue_events
        WHERE tenant_id = $1::uuid AND outbox_id = $2::uuid`,
      [tenantId, outboxId],
    )).rows[0]?.count ?? 0);
    assert.equal(requeueCount, 1);

    const lifecycle = (await c.query(
      `SELECT event_type
         FROM platform.governed_recovery_command_events
        WHERE tenant_id = $1::uuid AND recovery_command_id = $2::uuid
        ORDER BY occurred_at, created_at, recovery_command_event_id`,
      [tenantId, recoveryCommandId],
    )).rows.map((row) => row.event_type);
    assert.deepEqual(lifecycle, ['COMMAND_REQUESTED', 'COMMAND_CLAIMED', 'COMMAND_SUCCEEDED']);
  } finally {
    c.release();
    await p.end();
  }
});

test('two recovery workers cannot claim the same command', async () => {
  const p = pool(2);
  const c1 = await p.connect();
  const c2 = await p.connect();
  try {
    const tenantId = await createTenant(c1);
    await c2.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);
    const targetId = randomUUID();
    await requestRetry(c1, {
      tenantId,
      targetId,
      idempotencyKey: `claim-only:${targetId}`,
    });

    const now = new Date(Date.now() + 60_000);
    const [first, second] = await Promise.all([
      claimNextGovernedRecoveryCommand(c1, {
        tenantId,
        workerSubjectId: 'worker-1',
        now,
      }),
      claimNextGovernedRecoveryCommand(c2, {
        tenantId,
        workerSubjectId: 'worker-2',
        now,
      }),
    ]);

    assert.equal([first, second].filter((claim) => claim !== null).length, 1);
  } finally {
    c1.release();
    c2.release();
    await p.end();
  }
});
