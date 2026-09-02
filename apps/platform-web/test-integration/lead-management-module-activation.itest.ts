import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { grantTenantModuleEntitlement, listTenantProductModules } from '@expadio/postgres-runtime/product-module';
import { activateSimpleProductModule } from '@expadio/postgres-runtime/simple-product-module-activation';

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

test('Lead Management requires entitlement before activation and activates idempotently', async () => {
  const p = pool();
  const c = await p.connect();
  const tenantId = randomUUID();
  try {
    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name)
       VALUES ($1::uuid, 'Lead module integration tenant')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    const before = await listTenantProductModules(c, tenantId);
    assert.equal(before.find((item) => item.moduleKey === 'lead-management')?.availability, 'LOCKED_BY_PLAN');

    await c.query('BEGIN');
    await grantTenantModuleEntitlement(c, {
      tenantId,
      moduleKey: 'lead-management',
      sourceType: 'PLATFORM_GRANT',
      sourceKey: 'itest-lead-module',
      validFrom: new Date(Date.now() - 1_000),
      validUntil: new Date(Date.now() + 60_000),
      metadata: { purpose: 'activation integration proof' },
      actorSubjectId: 'platform-admin-itest',
      correlationId: randomUUID(),
    });
    await c.query('COMMIT');

    const ready = await listTenantProductModules(c, tenantId);
    assert.equal(ready.find((item) => item.moduleKey === 'lead-management')?.availability, 'READY_TO_ACTIVATE');

    await c.query('BEGIN');
    const activated = await activateSimpleProductModule(c, {
      tenantId,
      moduleKey: 'lead-management',
      actorSubjectId: 'platform-admin-itest',
      correlationId: randomUUID(),
    });
    await c.query('COMMIT');
    assert.equal(activated.status, 'ACTIVE');
    assert.equal(activated.idempotent, false);

    const active = await listTenantProductModules(c, tenantId);
    assert.equal(active.find((item) => item.moduleKey === 'lead-management')?.availability, 'ACTIVE');

    await c.query('BEGIN');
    const replay = await activateSimpleProductModule(c, {
      tenantId,
      moduleKey: 'lead-management',
      actorSubjectId: 'platform-admin-itest',
      correlationId: randomUUID(),
    });
    await c.query('COMMIT');
    assert.equal(replay.idempotent, true);
    assert.equal(replay.tenantModuleId, activated.tenantModuleId);

    const events = await c.query(
      `SELECT count(*)::int AS count
         FROM platform.domain_events
        WHERE tenant_id = $1::uuid
          AND aggregate_type = 'tenant.module'
          AND aggregate_id = $2
          AND event_type = 'tenant.module.activated'`,
      [tenantId, activated.tenantModuleId],
    );
    assert.equal(events.rows[0]?.count, 1);
  } finally {
    try { await c.query('ROLLBACK'); } catch {}
    c.release();
    await p.end();
  }
});
