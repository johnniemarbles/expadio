import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { appendDomainEventWithOutbox } from '@expadio/postgres-runtime/domain-events';
import { runDomainEventActionWorkerForTenants } from '../lib/domain-event-multi-tenant-runner';

function pool(): pg.Pool {
  return new pg.Pool({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    database: process.env.PGDATABASE ?? 'expadio_test',
    max: 3,
  });
}

async function seedEvent(
  client: pg.PoolClient,
  tenantId: string,
  label: string,
): Promise<string> {
  await client.query(
    `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
     VALUES ($1::uuid, $2, 'dentex')`,
    [tenantId, label],
  );
  await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

  const appended = await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId,
      aggregateType: 'crm.account',
      aggregateId: randomUUID(),
      eventType: 'Account.Observed',
      eventVersion: 1,
      occurredAt: new Date('2026-08-30T16:00:00.000Z'),
      actorSubjectId: 'multi-tenant-itest',
      correlationId: randomUUID(),
      packKey: 'dentex',
      payload: {},
    },
  });
  return appended.outboxId;
}

test('multi-tenant runner processes explicit tenants under isolated RLS contexts', async () => {
  const p = pool();
  const admin = await p.connect();
  try {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const outboxA = await seedEvent(admin, tenantA, 'Runner tenant A');
    const outboxB = await seedEvent(admin, tenantB, 'Runner tenant B');

    const summary = await runDomainEventActionWorkerForTenants(p, {
      tenantIds: [tenantA, tenantB],
      perTenantLimit: 2,
    });

    assert.equal(summary.tenantCount, 2);
    assert.equal(summary.succeededTenants, 2);
    assert.equal(summary.failedTenants, 0);
    assert.equal(summary.processed, 2);
    assert.equal(summary.published, 2);
    assert.deepEqual(
      summary.tenants.map((tenant) => [tenant.tenantId, tenant.status, tenant.summary?.published]),
      [
        [tenantA, 'SUCCEEDED', 1],
        [tenantB, 'SUCCEEDED', 1],
      ],
    );

    for (const [tenantId, outboxId] of [[tenantA, outboxA], [tenantB, outboxB]] as const) {
      await admin.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
      const row = (await admin.query(
        `SELECT status, attempts
           FROM platform.domain_event_outbox
          WHERE tenant_id = $1::uuid
            AND outbox_id = $2::uuid`,
        [tenantId, outboxId],
      )).rows[0];
      assert.deepEqual(row, { status: 'PUBLISHED', attempts: 1 });
    }

    const probe = await p.connect();
    try {
      const tenantSetting = (await probe.query(
        `SELECT current_setting('app.tenant_id', true) AS tenant_id`,
      )).rows[0]?.tenant_id;
      assert.ok(tenantSetting === null || tenantSetting === '');
    } finally {
      probe.release();
    }
  } finally {
    admin.release();
    await p.end();
  }
});
