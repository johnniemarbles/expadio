import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  DENTEX_PACK,
  resolveCaseSchema,
  transitionIndustryPackVersion,
  validateCaseAttributes,
} from '@expadio/industry-packs';
import { PostgresIndustryPackVersionRepository } from '@expadio/postgres-runtime/industry-pack-authoring';
import { PostgresIndustryPackRuntimeResolver } from '@expadio/postgres-runtime/industry-pack-runtime';

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

test('Industry Pack golden path publishes, binds, resolves and stamps the same version', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name) VALUES ($1::uuid, 'Pack golden path')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    const authoredDefinition = {
      ...DENTEX_PACK,
      label: 'Tenant DENTEX golden',
      caseSchema: {
        version: 2,
        fields: [
          { key: 'clinicCode', label: 'Clinic code', type: 'text', required: true },
        ],
      },
    } as const;

    const versions = new PostgresIndustryPackVersionRepository(c);
    const draft = await versions.createDraft({
      scope: { type: 'TENANT', tenantId },
      verticalKey: 'dentex',
      definition: authoredDefinition,
      createdBySubjectId: 'golden-author',
    });
    assert.equal(draft.state, 'DRAFT');

    const submittedSnapshot = transitionIndustryPackVersion({
      current: draft,
      to: 'IN_REVIEW',
      actorSubjectId: 'golden-author',
      occurredAt: '2026-08-29T19:10:00.000Z',
    });
    const submitted = await versions.transitionLifecycle({
      scope: { type: 'TENANT', tenantId },
      identity: draft.identity,
      expectedState: 'DRAFT',
      next: submittedSnapshot,
    });
    assert.equal(submitted.state, 'IN_REVIEW');

    const publishedSnapshot = transitionIndustryPackVersion({
      current: submitted,
      to: 'PUBLISHED',
      actorSubjectId: 'golden-reviewer',
      occurredAt: '2026-08-29T19:11:00.000Z',
    });
    const published = await versions.transitionLifecycle({
      scope: { type: 'TENANT', tenantId },
      identity: submitted.identity,
      expectedState: 'IN_REVIEW',
      next: publishedSnapshot,
    });
    assert.equal(published.state, 'PUBLISHED');

    await c.query(
      `UPDATE platform.tenants SET vertical_key = 'dentex' WHERE tenant_id = $1::uuid`,
      [tenantId],
    );

    const runtime = await new PostgresIndustryPackRuntimeResolver(c).resolve({
      tenantId,
      verticalKey: 'dentex',
    });
    assert.equal(runtime.provenance.source, 'TENANT_PUBLISHED');
    assert.equal(runtime.provenance.version, published.identity.version);
    assert.equal(runtime.pack?.label, 'Tenant DENTEX golden');

    const validated = validateCaseAttributes(
      resolveCaseSchema(runtime.pack),
      { clinicCode: ' CL-9 ' },
    );
    assert.equal(validated.ok, true);
    assert.deepEqual(validated.attributes, { clinicCode: 'CL-9' });
    assert.equal(validated.schemaVersion, 2);

    const stored = (await c.query(
      `INSERT INTO platform.crm_cases (
         tenant_id, subject, attributes, attributes_schema_version,
         industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source
       ) VALUES ($1::uuid, 'Golden treatment', $2::jsonb, $3, $4, $5, $6)
       RETURNING attributes, attributes_schema_version,
                 industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source`,
      [
        tenantId,
        JSON.stringify(validated.attributes),
        validated.schemaVersion,
        runtime.provenance.verticalKey,
        runtime.provenance.version,
        runtime.provenance.source,
      ],
    )).rows[0];

    assert.deepEqual(stored.attributes, { clinicCode: 'CL-9' });
    assert.equal(stored.attributes_schema_version, 2);
    assert.equal(stored.industry_pack_vertical_key, 'dentex');
    assert.equal(stored.industry_pack_version, published.identity.version);
    assert.equal(stored.industry_pack_runtime_source, 'TENANT_PUBLISHED');
  } finally {
    c.release();
    await p.end();
  }
});
