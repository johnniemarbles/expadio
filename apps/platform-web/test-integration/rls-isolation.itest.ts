import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

/**
 * Row-Level Security isolation — exercised under a REAL non-superuser role.
 *
 * Every other integration test connects as `postgres`, and a PostgreSQL
 * superuser bypasses RLS entirely — even under FORCE ROW LEVEL SECURITY. So the
 * tenant-isolation policies those tests rely on are never actually executed: a
 * broken `USING`/`WITH CHECK` clause would still pass them.
 *
 * This test closes that gap. It seeds two tenants as the superuser (RLS off),
 * then connects as a purpose-built NOSUPERUSER / NOBYPASSRLS role and proves the
 * `platform.vendors` policy genuinely enforces isolation: a tenant cannot read,
 * insert-as, update, or delete another tenant's rows. If the role ever silently
 * gained superuser, the guard assertion below fails rather than passing blindly.
 */

const APP_ROLE = 'expadio_rls_tester';

function connectInfo() {
  return {
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? 'expadio_test',
  };
}

function superuserPool(): pg.Pool {
  return new pg.Pool({ ...connectInfo(), user: process.env.PGUSER ?? 'postgres', password: process.env.PGPASSWORD ?? 'postgres', max: 1 });
}

/** A pool that authenticates as the least-privilege application role. */
function appRolePool(): pg.Pool {
  return new pg.Pool({ ...connectInfo(), user: APP_ROLE, max: 1 });
}

async function ensureAppRole(su: pg.PoolClient): Promise<void> {
  // Idempotent: the role survives across runs; grants are re-applied each time.
  await su.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
      CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$;`);
  await su.query(`GRANT USAGE ON SCHEMA platform TO ${APP_ROLE}`);
  await su.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO ${APP_ROLE}`);
  await su.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform TO ${APP_ROLE}`);
}

async function seedTenantVendor(su: pg.PoolClient, tenantId: string): Promise<string> {
  await su.query(`INSERT INTO platform.tenants (tenant_id, name) VALUES ($1, 'rls-itest')`, [tenantId]);
  const vendorId = (await su.query(
    `INSERT INTO platform.vendors (tenant_id, legal_name, blueprint_key) VALUES ($1, 'Isolated Co', 'vendor.onboarding') RETURNING vendor_id`,
    [tenantId],
  )).rows[0].vendor_id as string;
  return vendorId;
}

const setTenant = (c: pg.PoolClient, tenantId: string) => c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

test('vendor RLS actually isolates tenants under a non-superuser role', async () => {
  const su = superuserPool();
  const suc = await su.connect();
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let app: pg.Pool | null = null;

  try {
    await ensureAppRole(suc);
    const vendorA = await seedTenantVendor(suc, tenantA);
    const vendorB = await seedTenantVendor(suc, tenantB);

    app = appRolePool();
    const c = await app.connect();
    try {
      // Guard: if this ever runs as a superuser (or BYPASSRLS), the test would
      // pass without proving anything — so fail loudly instead.
      const priv = await c.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
      assert.equal(priv.rows[0].rolsuper, false, 'the RLS test role must not be a superuser');
      assert.equal(priv.rows[0].rolbypassrls, false, 'the RLS test role must not bypass RLS');

      // As tenant A: sees only A's vendor.
      await setTenant(c, tenantA);
      const seenAsA = await c.query(`SELECT vendor_id FROM platform.vendors ORDER BY created_at`);
      assert.deepEqual(seenAsA.rows.map((r) => r.vendor_id), [vendorA], 'tenant A must see only its own vendor');

      // As tenant B: A's vendor is invisible; B sees only its own.
      await setTenant(c, tenantB);
      const seenAsB = await c.query(`SELECT vendor_id FROM platform.vendors`);
      assert.deepEqual(seenAsB.rows.map((r) => r.vendor_id), [vendorB], 'tenant B must see only its own vendor');
      const crossRead = await c.query(`SELECT 1 FROM platform.vendors WHERE vendor_id = $1`, [vendorA]);
      assert.equal(crossRead.rowCount, 0, "tenant B must not read tenant A's vendor by id");

      // WITH CHECK: while acting as B, inserting a row stamped for A is rejected.
      await assert.rejects(
        c.query(`INSERT INTO platform.vendors (tenant_id, legal_name, blueprint_key) VALUES ($1, 'Forged', 'vendor.onboarding')`, [tenantA]),
        (err: unknown) => (err as { code?: string }).code === '42501',
        'inserting a foreign-tenant row must violate the RLS WITH CHECK',
      );

      // Cross-tenant UPDATE / DELETE affect zero rows (A's vendor is not visible to B).
      const upd = await c.query(`UPDATE platform.vendors SET legal_name = 'hijacked' WHERE vendor_id = $1`, [vendorA]);
      assert.equal(upd.rowCount, 0, "tenant B must not update tenant A's vendor");
      const del = await c.query(`DELETE FROM platform.vendors WHERE vendor_id = $1`, [vendorA]);
      assert.equal(del.rowCount, 0, "tenant B must not delete tenant A's vendor");

      // Back as A: the row is untouched — B's writes never reached it.
      await setTenant(c, tenantA);
      const finalA = await c.query(`SELECT legal_name FROM platform.vendors WHERE vendor_id = $1`, [vendorA]);
      assert.equal(finalA.rowCount, 1, "tenant A's vendor must still exist");
      assert.equal(finalA.rows[0].legal_name, 'Isolated Co', "tenant A's vendor must be unmodified");
    } finally {
      c.release();
    }
  } finally {
    // Clean up seeded rows as the superuser (RLS bypassed); leave the role for reuse.
    await suc.query(`DELETE FROM platform.vendors WHERE tenant_id = ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await suc.query(`DELETE FROM platform.tenants WHERE tenant_id = ANY($1::uuid[])`, [[tenantA, tenantB]]);
    suc.release();
    await su.end();
    if (app) await app.end();
  }
});
