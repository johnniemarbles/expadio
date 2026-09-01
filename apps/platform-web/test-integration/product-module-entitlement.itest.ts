import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  grantTenantModuleEntitlement,
  listTenantModuleEntitlements,
  listTenantProductModules,
  revokeTenantModuleEntitlement,
} from '@expadio/postgres-runtime/product-module';

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

test('Platform entitlement grant and revoke drive effective module availability with audit evidence', async () => {
  const p = pool();
  const c = await p.connect();
  const tenantId = randomUUID();
  try {
    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name)
       VALUES ($1::uuid, 'Entitlement integration tenant')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    const before = await listTenantProductModules(c, tenantId);
    assert.equal(before.find((item) => item.moduleKey === 'learning')?.availability, 'LOCKED_BY_PLAN');

    await c.query('BEGIN');
    const granted = await grantTenantModuleEntitlement(c, {
      tenantId,
      moduleKey: 'learning',
      sourceType: 'PLATFORM_GRANT',
      sourceKey: 'itest-manual-grant',
      validFrom: new Date(Date.now() - 1_000),
      validUntil: new Date(Date.now() + 60_000),
      metadata: { note: 'integration proof' },
      actorSubjectId: 'platform-admin-itest',
      correlationId: randomUUID(),
    });
    await c.query('COMMIT');
    assert.equal(granted.idempotent, false);
    assert.equal(granted.entitlement.effectiveState, 'ACTIVE');

    const afterGrant = await listTenantProductModules(c, tenantId);
    assert.equal(afterGrant.find((item) => item.moduleKey === 'learning')?.availability, 'READY_TO_ACTIVATE');

    await c.query('BEGIN');
    const replay = await grantTenantModuleEntitlement(c, {
      tenantId,
      moduleKey: 'learning',
      sourceType: 'PLATFORM_GRANT',
      sourceKey: 'itest-manual-grant',
      validFrom: new Date(granted.entitlement.validFrom),
      validUntil: new Date(granted.entitlement.validUntil!),
      metadata: { note: 'integration proof' },
      actorSubjectId: 'platform-admin-itest',
      correlationId: randomUUID(),
    });
    await c.query('COMMIT');
    assert.equal(replay.idempotent, true);

    const history = await listTenantModuleEntitlements(c, {
      tenantId,
      moduleKey: 'learning',
    });
    assert.equal(history.length, 1);

    await c.query('BEGIN');
    const revoked = await revokeTenantModuleEntitlement(c, {
      tenantId,
      moduleKey: 'learning',
      entitlementId: granted.entitlement.entitlementId,
      actorSubjectId: 'platform-admin-itest',
      correlationId: randomUUID(),
      reason: 'integration revocation',
    });
    await c.query('COMMIT');
    assert.equal(revoked.entitlement.effectiveState, 'REVOKED');

    const afterRevoke = await listTenantProductModules(c, tenantId);
    assert.equal(afterRevoke.find((item) => item.moduleKey === 'learning')?.availability, 'LOCKED_BY_PLAN');

    const events = await c.query(
      `SELECT event_type, count(*)::int AS count
         FROM platform.domain_events
        WHERE tenant_id = $1::uuid
          AND aggregate_type = 'tenant.module.entitlement'
        GROUP BY event_type
        ORDER BY event_type`,
      [tenantId],
    );
    assert.deepEqual(events.rows, [
      { event_type: 'tenant.module.entitlement.granted', count: 1 },
      { event_type: 'tenant.module.entitlement.revoked', count: 1 },
    ]);
  } finally {
    try { await c.query('ROLLBACK'); } catch {}
    c.release();
    await p.end();
  }
});
