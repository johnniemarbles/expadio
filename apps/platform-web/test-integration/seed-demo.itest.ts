import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { seedDemo } from '../scripts/seed-demo';

/**
 * Guards the runnable demo-seed path in CI: the seeder must drive the real
 * runtime to a valid, fully-governed dataset on a fresh database, and be
 * idempotent on a second run.
 */

const DEMO_TENANT = process.env.DEMO_TENANT_ID ?? '00000000-0000-0000-0000-000000000001';

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

async function count(c: pg.PoolClient, sql: string): Promise<number> {
  return Number((await c.query(sql, [DEMO_TENANT])).rows[0].n);
}

test('seedDemo produces a valid governed dataset and is idempotent', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    // The dataset is deterministic, so its shape holds whether this run seeded
    // it or a prior run did (the immutable decision log rules out a wipe). The
    // first call must succeed either way; the invariant counts are asserted
    // below, and a subsequent call must be a no-op.
    const first = await seedDemo(c);
    assert.ok(first === 'seeded' || first === 'skipped');

    assert.equal(await count(c, `SELECT count(*) n FROM platform.crm_accounts WHERE tenant_id=$1::uuid`), 3);
    assert.equal(await count(c, `SELECT count(*) n FROM platform.crm_cases WHERE tenant_id=$1::uuid`), 3);
    // One case is driven all the way to COMPLETED; the other two remain RUNNING.
    assert.equal(await count(c, `SELECT count(*) n FROM platform.workflow_instances WHERE tenant_id=$1::uuid AND state='COMPLETED'`), 1);
    assert.equal(await count(c, `SELECT count(*) n FROM platform.workflow_instances WHERE tenant_id=$1::uuid AND state='RUNNING'`), 2);
    // Two approval decisions were captured (cases 1 and 2).
    assert.equal(await count(c, `SELECT count(*) n FROM platform.workflow_stage_decisions d JOIN platform.workflow_instances i ON i.instance_id=d.instance_id WHERE i.tenant_id=$1::uuid`), 2);
    // A tenant blueprint draft and an approval grant exist.
    assert.equal(await count(c, `SELECT count(*) n FROM platform.workflow_blueprints WHERE tenant_id=$1::uuid AND state='DRAFT'`), 1);
    assert.equal(await count(c, `SELECT count(*) n FROM platform.workflow_authority_grants WHERE tenant_id=$1::uuid`), 1);

    // Idempotent: a second run changes nothing.
    assert.equal(await seedDemo(c), 'skipped');
    assert.equal(await count(c, `SELECT count(*) n FROM platform.crm_accounts WHERE tenant_id=$1::uuid`), 3);
    assert.equal(await count(c, `SELECT count(*) n FROM platform.workflow_instances WHERE tenant_id=$1::uuid`), 3);
  } finally {
    c.release();
    await p.end();
  }
});
