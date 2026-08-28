import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { startWorkflow } from '../lib/workflow-runtime';
import {
  listBlueprintsForAuthoring,
  createTenantDraftFromPlatform,
  publishTenantBlueprint,
} from '../lib/workflow-blueprints';

/**
 * DB-backed integration harness for tenant blueprint authoring.
 *
 * Proves the authoring vertical end to end against a live Postgres: a tenant
 * clones the platform crm.case blueprint into a DRAFT, publishes it ACTIVE, and
 * from that point new case workflows resolve the tenant's own blueprint instead
 * of the platform default — and publishing a newer draft atomically supersedes
 * the prior tenant ACTIVE.
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

async function withClient(body: (c: pg.PoolClient) => Promise<void>): Promise<void> {
  const p = pool();
  const c = await p.connect();
  try {
    await body(c);
  } finally {
    c.release();
    await p.end();
  }
}

async function seedTenant(c: pg.PoolClient): Promise<{ tenantId: string }> {
  const tenantId = randomUUID();
  await c.query(`INSERT INTO platform.tenants (tenant_id, name) VALUES ($1, 'itest')`, [tenantId]);
  await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
  return { tenantId };
}

async function makeCase(c: pg.PoolClient, tenantId: string): Promise<string> {
  return (await c.query(
    `INSERT INTO platform.crm_cases (tenant_id, subject, blueprint_key) VALUES ($1, 'Case', 'crm.case') RETURNING case_id`,
    [tenantId],
  )).rows[0].case_id as string;
}

async function tenantActiveVersions(c: pg.PoolClient, tenantId: string): Promise<number[]> {
  const rows = (await c.query(
    `SELECT version FROM platform.workflow_blueprints
      WHERE tenant_id = $1::uuid AND work_type_key = 'crm.case' AND state = 'ACTIVE'
      ORDER BY version`,
    [tenantId],
  )).rows;
  return rows.map((r) => r.version as number);
}

test('a published tenant blueprint overrides the platform default at case start', async () => {
  await withClient(async (c) => {
    const { tenantId } = await seedTenant(c);

    // A clone is a DRAFT off the ACTIVE platform blueprint, with it as parent.
    const draft = await createTenantDraftFromPlatform(c, { tenantId, blueprintKey: 'crm.case' });
    assert.ok(draft.ok, 'draft created');
    assert.equal(draft.blueprint.state, 'DRAFT');
    assert.equal(draft.blueprint.source, 'TENANT_CUSTOMIZED');
    assert.equal(draft.blueprint.parent?.blueprintKey, 'crm.case');
    assert.ok(draft.blueprint.stages.length >= 4, 'stages copied from platform');
    const version = draft.blueprint.version;

    // Before publish, a case still starts on the platform blueprint.
    const before = await startWorkflow(c, { tenantId, subjectType: 'crm.case', subjectId: await makeCase(c, tenantId), blueprintKey: 'crm.case' });
    assert.ok(before.ok && before.instance.blueprint.scope === 'PLATFORM');

    // Publish the draft ACTIVE (no prior tenant ACTIVE to supersede).
    const published = await publishTenantBlueprint(c, { tenantId, blueprintKey: 'crm.case', version, publishedBySubjectId: 'admin' });
    assert.ok(published.ok && published.supersededVersion === null);

    // Now a new case resolves the tenant blueprint (same key, tenant scope, its version).
    const after = await startWorkflow(c, { tenantId, subjectType: 'crm.case', subjectId: await makeCase(c, tenantId), blueprintKey: 'crm.case' });
    assert.ok(after.ok && after.instance.blueprint.scope === 'TENANT' && after.instance.blueprint.version === version);

    // Exactly one tenant version is ACTIVE, and the authoring list shows both catalogues.
    assert.deepEqual(await tenantActiveVersions(c, tenantId), [version]);
    const list = await listBlueprintsForAuthoring(c, { tenantId });
    assert.ok(list.some((b) => b.scope === 'PLATFORM' && b.blueprintKey === 'crm.case' && b.state === 'ACTIVE'));
    assert.ok(list.some((b) => b.scope === 'TENANT' && b.version === version && b.state === 'ACTIVE'));
  });
});

test('publishing a newer tenant draft atomically supersedes the prior active version', async () => {
  await withClient(async (c) => {
    const { tenantId } = await seedTenant(c);

    const v1 = (await createTenantDraftFromPlatform(c, { tenantId, blueprintKey: 'crm.case' }));
    assert.ok(v1.ok);
    assert.ok((await publishTenantBlueprint(c, { tenantId, blueprintKey: 'crm.case', version: v1.blueprint.version, publishedBySubjectId: 'admin' })).ok);

    const v2 = (await createTenantDraftFromPlatform(c, { tenantId, blueprintKey: 'crm.case' }));
    assert.ok(v2.ok);
    assert.notEqual(v2.blueprint.version, v1.blueprint.version);
    const swap = await publishTenantBlueprint(c, { tenantId, blueprintKey: 'crm.case', version: v2.blueprint.version, publishedBySubjectId: 'admin' });
    assert.ok(swap.ok && swap.supersededVersion === v1.blueprint.version);

    // Only the newest version remains ACTIVE; the unique-active invariant holds.
    assert.deepEqual(await tenantActiveVersions(c, tenantId), [v2.blueprint.version]);
    const started = await startWorkflow(c, { tenantId, subjectType: 'crm.case', subjectId: await makeCase(c, tenantId), blueprintKey: 'crm.case' });
    assert.ok(started.ok && started.instance.blueprint.version === v2.blueprint.version);
  });
});

test('publish is rejected for a missing or non-publishable blueprint', async () => {
  await withClient(async (c) => {
    const { tenantId } = await seedTenant(c);

    const missing = await publishTenantBlueprint(c, { tenantId, blueprintKey: 'crm.case', version: 999, publishedBySubjectId: 'admin' });
    assert.ok(missing.ok === false && missing.reason === 'NOT_FOUND');

    const draft = await createTenantDraftFromPlatform(c, { tenantId, blueprintKey: 'crm.case' });
    assert.ok(draft.ok);
    assert.ok((await publishTenantBlueprint(c, { tenantId, blueprintKey: 'crm.case', version: draft.blueprint.version, publishedBySubjectId: 'admin' })).ok);
    // Publishing an already-ACTIVE version is not allowed.
    const again = await publishTenantBlueprint(c, { tenantId, blueprintKey: 'crm.case', version: draft.blueprint.version, publishedBySubjectId: 'admin' });
    assert.ok(again.ok === false && again.reason === 'NOT_PUBLISHABLE');

    // Cloning an unknown key yields a clean not-found, not a throw.
    const unknown = await createTenantDraftFromPlatform(c, { tenantId, blueprintKey: 'does.not.exist' });
    assert.ok(unknown.ok === false && unknown.reason === 'PLATFORM_BASE_NOT_FOUND');
  });
});
