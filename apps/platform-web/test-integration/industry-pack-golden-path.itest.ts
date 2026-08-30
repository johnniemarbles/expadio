import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  DENTEX_PACK,
  resolveCaseSchema,
  transitionIndustryPackVersion,
  validateCaseAttributes,
  validateIndustryPackDefinition,
} from '@expadio/industry-packs';
import { PostgresIndustryPackVersionRepository } from '@expadio/postgres-runtime/industry-pack-authoring';
import { PostgresIndustryPackRuntimeResolver } from '@expadio/postgres-runtime/industry-pack-runtime';
import { startWorkflow, transitionWorkflow } from '../lib/workflow-runtime';
import { assignParticipant } from '../lib/workflow-participants';

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


test('authored Pack semantics survive publish and govern the canonical CRM transition', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Pack semantic golden path', 'dentex')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    const authoredInput = {
      ...DENTEX_PACK,
      label: 'Tenant DENTEX semantic golden',
      caseSchema: {
        version: 2,
        fields: [
          { key: 'clinicCode', label: 'Clinic code', type: 'text', required: false },
        ],
      },
      caseStageSemantics: {
        requirements: [
          {
            stageKey: 'IN_PROGRESS',
            phase: 'EXIT',
            requiredAttributeKeys: ['clinicCode'],
            message: 'Record the clinic code before clinical review.',
          },
        ],
      },
    } as const;

    const validation = validateIndustryPackDefinition(authoredInput, 'dentex');
    assert.equal(validation.valid, true);
    if (!validation.valid) throw new Error('authored Pack validation unexpectedly failed');

    const versions = new PostgresIndustryPackVersionRepository(c);
    const draft = await versions.createDraft({
      scope: { type: 'TENANT', tenantId },
      verticalKey: 'dentex',
      definition: validation.definition,
      createdBySubjectId: 'semantic-author',
    });
    const submitted = await versions.transitionLifecycle({
      scope: { type: 'TENANT', tenantId },
      identity: draft.identity,
      expectedState: 'DRAFT',
      next: transitionIndustryPackVersion({
        current: draft,
        to: 'IN_REVIEW',
        actorSubjectId: 'semantic-author',
        occurredAt: '2026-08-30T02:40:00.000Z',
      }),
    });
    const published = await versions.transitionLifecycle({
      scope: { type: 'TENANT', tenantId },
      identity: submitted.identity,
      expectedState: 'IN_REVIEW',
      next: transitionIndustryPackVersion({
        current: submitted,
        to: 'PUBLISHED',
        actorSubjectId: 'semantic-reviewer',
        occurredAt: '2026-08-30T02:41:00.000Z',
      }),
    });

    const runtimePack = await new PostgresIndustryPackRuntimeResolver(c).resolve({
      tenantId,
      verticalKey: 'dentex',
    });
    assert.equal(runtimePack.provenance.source, 'TENANT_PUBLISHED');
    assert.equal(runtimePack.provenance.version, published.identity.version);
    assert.equal(
      runtimePack.pack?.caseStageSemantics?.requirements[0]?.requiredAttributeKeys?.[0],
      'clinicCode',
    );

    const caseId = (await c.query(
      `INSERT INTO platform.crm_cases (
         tenant_id, subject, blueprint_key, attributes, attributes_schema_version,
         industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source
       ) VALUES (
         $1::uuid, 'Semantic treatment', 'crm.case', '{}'::jsonb, 2,
         'dentex', $2, 'TENANT_PUBLISHED'
       )
       RETURNING case_id`,
      [tenantId, published.identity.version],
    )).rows[0].case_id as string;

    const started = await startWorkflow(c, {
      tenantId,
      subjectType: 'crm.case',
      subjectId: caseId,
      blueprintKey: 'crm.case',
      industryPackProvenance: {
        runtimeSource: 'TENANT_PUBLISHED',
        verticalKey: 'dentex',
        version: published.identity.version,
      },
    });
    assert.ok(started.ok);
    const instanceId = started.instance.instanceId;
    const mover = `${tenantId.slice(0, 8)}-semantic-mover`;

    const inProgress = await transitionWorkflow(c, {
      tenantId,
      instanceId,
      expectedRevision: started.instance.revision,
      toStageKey: 'IN_PROGRESS',
      requestedBySubjectId: mover,
    });
    assert.ok(inProgress.ok);

    await assignParticipant(c, {
      tenantId,
      instanceId,
      stageKey: 'REVIEW',
      participantKey: 'reviewer',
      targetKind: 'USER',
      targetKey: mover,
      assignedBySubjectId: mover,
    });

    const blocked = await transitionWorkflow(c, {
      tenantId,
      instanceId,
      expectedRevision: inProgress.instance.revision,
      toStageKey: 'REVIEW',
      requestedBySubjectId: mover,
    });
    assert.ok(blocked.ok === false && blocked.reason === 'GATE_BLOCKED');
    if (blocked.ok || blocked.reason !== 'GATE_BLOCKED') {
      throw new Error('authored semantic gate unexpectedly allowed transition');
    }
    assert.deepEqual(
      blocked.blockers.map((item) => [item.code, item.key, item.message]),
      [[
        'CASE_SEMANTIC_ATTRIBUTE_REQUIRED',
        'clinicCode',
        'Record the clinic code before clinical review.',
      ]],
    );

    await c.query(
      `UPDATE platform.crm_cases
          SET attributes = jsonb_build_object('clinicCode', 'CL-9')
        WHERE tenant_id = $1::uuid AND case_id = $2::uuid`,
      [tenantId, caseId],
    );

    const allowed = await transitionWorkflow(c, {
      tenantId,
      instanceId,
      expectedRevision: inProgress.instance.revision,
      toStageKey: 'REVIEW',
      requestedBySubjectId: mover,
    });
    assert.ok(allowed.ok && allowed.instance.currentStageKey === 'REVIEW');
  } finally {
    c.release();
    await p.end();
  }
});
