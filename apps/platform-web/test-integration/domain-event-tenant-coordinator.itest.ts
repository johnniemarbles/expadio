import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  runDueTenantExecutionCoordinator,
} from '../lib/domain-event-tenant-coordinator';

const APP_ROLE = 'expadio_scheduler_rls_tester';
const APP_ROLE_PASSWORD = 'scheduler_rls_test';

function connectInfo() {
  return {
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? 'expadio_test',
  };
}

function superuserPool(): pg.Pool {
  return new pg.Pool({
    ...connectInfo(),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    max: 2,
  });
}

function appRolePool(): pg.Pool {
  return new pg.Pool({
    ...connectInfo(),
    user: APP_ROLE,
    password: APP_ROLE_PASSWORD,
    max: 4,
  });
}

async function ensureAppRole(su: pg.PoolClient): Promise<void> {
  await su.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
      CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$;`);
  await su.query(
    `ALTER ROLE ${APP_ROLE} WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_ROLE_PASSWORD}'`,
  );
  await su.query(`GRANT USAGE ON SCHEMA platform TO ${APP_ROLE}`);
  await su.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO ${APP_ROLE}`,
  );
  await su.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform TO ${APP_ROLE}`,
  );
}

test('tenant scheduler RLS isolates normal tenants and permits explicit machine coordinator coverage', async () => {
  const su = superuserPool();
  const suc = await su.connect();
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const now = new Date('2026-08-30T10:00:00.000Z');
  let app: pg.Pool | null = null;

  try {
    await ensureAppRole(suc);

    await suc.query(
      `INSERT INTO platform.tenants (tenant_id, name)
       VALUES ($1::uuid, 'scheduler-a'), ($2::uuid, 'scheduler-b')`,
      [tenantA, tenantB],
    );
    await suc.query(
      `INSERT INTO platform.domain_event_scheduler_targets
         (tenant_id, execution_enabled, cadence_seconds, next_scheduled_at)
       VALUES
         ($1::uuid, true, 300, $3),
         ($2::uuid, true, 600, $3)`,
      [tenantA, tenantB, new Date(now.getTime() - 1_000)],
    );

    app = appRolePool();
    const tenantClient = await app.connect();
    try {
      const role = await tenantClient.query(
        `SELECT rolsuper, rolbypassrls
           FROM pg_roles
          WHERE rolname = current_user`,
      );
      assert.equal(role.rows[0].rolsuper, false);
      assert.equal(role.rows[0].rolbypassrls, false);

      await tenantClient.query(
        "SELECT set_config('app.tenant_id', $1, false)",
        [tenantA],
      );
      const visible = await tenantClient.query(
        `SELECT tenant_id
           FROM platform.domain_event_scheduler_targets
          ORDER BY tenant_id`,
      );
      assert.deepEqual(
        visible.rows.map((row) => row.tenant_id),
        [tenantA],
        'normal tenant context must not enumerate other scheduling targets',
      );
    } finally {
      tenantClient.release();
    }

    const result = await runDueTenantExecutionCoordinator(app, {
      maxTenants: 10,
      perTenantLimit: 1,
      now: () => now,
    });

    assert.equal(result.dueTenantCount, 2);
    assert.ok(result.summary);
    assert.equal(result.summary?.tenantCount, 2);
    assert.equal(result.summary?.failedTenants, 0);

    const rows = await suc.query(
      `SELECT tenant_id, next_scheduled_at, last_result
         FROM platform.domain_event_scheduler_targets
        WHERE tenant_id = ANY($1::uuid[])
        ORDER BY tenant_id`,
      [[tenantA, tenantB]],
    );
    assert.equal(rows.rowCount, 2);
    for (const row of rows.rows) {
      assert.equal(row.last_result, 'SUCCEEDED');
      assert.ok(new Date(row.next_scheduled_at).getTime() > now.getTime());
    }
  } finally {
    await suc.query(
      `DELETE FROM platform.domain_event_tenant_execution_runs
        WHERE tenant_id = ANY($1::uuid[])`,
      [[tenantA, tenantB]],
    );
    await suc.query(
      `DELETE FROM platform.domain_event_tenant_execution_state
        WHERE tenant_id = ANY($1::uuid[])`,
      [[tenantA, tenantB]],
    );
    await suc.query(
      `DELETE FROM platform.domain_event_scheduler_targets
        WHERE tenant_id = ANY($1::uuid[])`,
      [[tenantA, tenantB]],
    );
    await suc.query(
      `DELETE FROM platform.tenants
        WHERE tenant_id = ANY($1::uuid[])`,
      [[tenantA, tenantB]],
    );
    suc.release();
    await su.end();
    if (app) await app.end();
  }
});
