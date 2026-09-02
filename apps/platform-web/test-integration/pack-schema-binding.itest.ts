import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { ACME_CORP_PACK, resolveCaseSchema, validateCaseAttributes } from '@expadio/industry-packs';
import { PostgresIndustryPackRuntimeResolver } from '@expadio/postgres-runtime/industry-pack-runtime';

/**
 * The seam POST /api/crm/cases relies on: a tenant's stored `vertical_key`
 * selects which Industry Pack family validates that tenant's cases. The route
 * reads platform.tenants.vertical_key, resolves the executable PUBLISHED pack
 * through PostgresIndustryPackRuntimeResolver, validates the submitted attributes
 * against that definition, and stores the normalized bag. Runtime resolution and
 * the validator are unit-tested independently,
 * and the JSONB column in crm-case-attributes.itest; this proves the whole
 * chain composes on a real Postgres — the DB-stored binding actually drives the
 * schema, rejects an invalid case, and stores a valid one — for both packs and
 * the neutral engine.
 *
 * (The route itself imports next/server and can't run under this harness, so we
 * reproduce its resolution — read vertical_key, resolve the governed runtime
 * pack, validateCaseAttributes — faithfully, against the same schema the route uses.)
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

// The route's resolution, over a live tenant row: read the binding, resolve the
// schema, validate, and (when valid) persist onto the case.
async function bindResolveValidate(
  c: pg.PoolClient,
  tenantId: string,
  submitted: Record<string, unknown>,
) {
  const row = (await c.query(
    `SELECT vertical_key FROM platform.tenants WHERE tenant_id = $1::uuid`,
    [tenantId],
  )).rows[0];
  const resolved = await new PostgresIndustryPackRuntimeResolver(c).resolve({
    tenantId,
    verticalKey: row?.vertical_key ?? null,
  });
  const schema = resolveCaseSchema(resolved.pack);
  return validateCaseAttributes(schema, submitted);
}

async function seedTenant(c: pg.PoolClient, verticalKey: string | null): Promise<string> {
  const tenantId = randomUUID();
  await c.query(
    `INSERT INTO platform.tenants (tenant_id, name, vertical_key) VALUES ($1, 'itest', $2)`,
    [tenantId, verticalKey],
  );
  await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
  return tenantId;
}

test('a LEXFLOW-bound tenant is validated against the legal schema', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = await seedTenant(c, 'lexflow');

    // The required select (matterType) is enforced from the stored binding.
    const missing = await bindResolveValidate(c, tenantId, { jurisdiction: 'NY' });
    assert.equal(missing.ok, false);
    assert.match(missing.errors.join(' '), /Matter type is required/);

    // A bad option is rejected; nothing is invented.
    const bad = await bindResolveValidate(c, tenantId, { matterType: 'Tax' });
    assert.equal(bad.ok, false);

    // A valid Matter normalizes and persists as the case's attributes, stamped
    // with the schema revision that validated it.
    const good = await bindResolveValidate(c, tenantId, { matterType: 'Litigation', jurisdiction: ' NY ', junk: 'x' });
    assert.equal(good.ok, true);
    assert.deepEqual(good.attributes, { matterType: 'Litigation', jurisdiction: 'NY' });
    assert.equal(good.schemaVersion, 1, 'the legal schema is version 1');

    const stored = (await c.query(
      `INSERT INTO platform.crm_cases (tenant_id, subject, attributes, attributes_schema_version)
       VALUES ($1, 'Acme v. Roe', $2::jsonb, $3) RETURNING attributes, attributes_schema_version`,
      [tenantId, JSON.stringify(good.attributes), good.schemaVersion],
    )).rows[0];
    assert.deepEqual(stored.attributes, { matterType: 'Litigation', jurisdiction: 'NY' });
    assert.equal(stored.attributes_schema_version, 1, 'the case records which schema version validated it');
  } finally {
    c.release();
    await p.end();
  }
});

test('an ACME Corp-bound tenant is validated against its service schema', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = await seedTenant(c, 'acme-corp');

    // ACME Corp's required service fields govern this tenant's cases.
    const missing = await bindResolveValidate(c, tenantId, { referenceCode: 'SR-1' });
    assert.equal(missing.ok, false);
    assert.match(missing.errors.join(' '), /Service type is required/);
    assert.match(missing.errors.join(' '), /Priority is required/);

    const good = await bindResolveValidate(c, tenantId, {
      serviceType: 'Consulting',
      priority: 'High',
      referenceCode: ' SR-1 ',
      junk: 'x',
    });
    assert.equal(good.ok, true);
    assert.deepEqual(good.attributes, {
      serviceType: 'Consulting',
      priority: 'High',
      referenceCode: 'SR-1',
    });
  } finally {
    c.release();
    await p.end();
  }
});

test('tenant PUBLISHED pack overrides the code baseline at runtime', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = await seedTenant(c, 'acme-corp');
    const authored = {
      ...ACME_CORP_PACK,
      label: 'Tenant ACME Corp v2',
      caseSchema: {
        version: 2,
        fields: [
          { key: 'clinicCode', label: 'Clinic code', type: 'text', required: true },
        ],
      },
    };

    await c.query(
      `INSERT INTO platform.industry_pack_versions
         (tenant_id, vertical_key, version, source, state, revision, definition,
          created_by_subject_id, updated_by_subject_id)
       VALUES ($1::uuid, 'acme-corp', 2, 'TENANT_AUTHORED', 'PUBLISHED', 1, $2::jsonb,
               'itest-author', 'itest-author')`,
      [tenantId, JSON.stringify(authored)],
    );

    const baselineOnlyValue = await bindResolveValidate(c, tenantId, { urgency: 'Emergency' });
    assert.equal(baselineOnlyValue.ok, false);
    assert.match(baselineOnlyValue.errors.join(' '), /Clinic code is required/);

    const governed = await bindResolveValidate(c, tenantId, { clinicCode: ' C-12 ' });
    assert.equal(governed.ok, true);
    assert.deepEqual(governed.attributes, { clinicCode: 'C-12' });
    assert.equal(governed.schemaVersion, 2);
  } finally {
    c.release();
    await p.end();
  }
});

test('an unbound tenant uses the neutral engine — no fields, nothing stored', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = await seedTenant(c, null);

    // The neutral engine declares no fields, so any submission is accepted and
    // reduced to an empty bag — no pack data leaks onto a neutral case.
    const res = await bindResolveValidate(c, tenantId, { matterType: 'Litigation', tooth: 'UR6' });
    assert.equal(res.ok, true);
    assert.deepEqual(res.attributes, {});
    assert.equal(res.schemaVersion, 0, 'the neutral engine has no schema (version 0)');

    // version 0 → the route stores NULL (no schema governed this case).
    const stored = (await c.query(
      `INSERT INTO platform.crm_cases (tenant_id, subject, attributes, attributes_schema_version)
       VALUES ($1, 'Generic case', $2::jsonb, $3) RETURNING attributes, attributes_schema_version`,
      [tenantId, JSON.stringify(res.attributes), res.schemaVersion > 0 ? res.schemaVersion : null],
    )).rows[0];
    assert.deepEqual(stored.attributes, {});
    assert.equal(stored.attributes_schema_version, null, 'a neutral case carries no schema version');
  } finally {
    c.release();
    await p.end();
  }
});
