import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

/**
 * The crm_cases.attributes JSONB column stores a pack's domain fields and round
 * trips as an object. (The pack schema and its validation are unit-tested in
 * @expadio/industry-packs, and the route wiring by contract test; this proves
 * migration 0057 and the column's behaviour on a real Postgres.)
 */

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

test('a case stores and returns pack domain attributes', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    await c.query(`INSERT INTO platform.tenants (tenant_id, name) VALUES ($1, 'itest')`, [tenantId]);
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    const row = (await c.query(
      `INSERT INTO platform.crm_cases (tenant_id, subject, attributes)
       VALUES ($1, 'Root canal on UR6', $2::jsonb)
       RETURNING attributes`,
      [tenantId, JSON.stringify({ tooth: 'UR6', urgency: 'Priority' })],
    )).rows[0];
    assert.deepEqual(row.attributes, { tooth: 'UR6', urgency: 'Priority' });

    // A case with no attributes defaults to an empty object, not null.
    const bare = (await c.query(
      `INSERT INTO platform.crm_cases (tenant_id, subject) VALUES ($1,'Checkup') RETURNING attributes`,
      [tenantId],
    )).rows[0];
    assert.deepEqual(bare.attributes, {});
  } finally {
    c.release();
    await p.end();
  }
});
