import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  UPSERT_CAPTURE_CRM_LEAD_SQL,
  buildTrustedCaptureConvertWrite,
  captureConvertBindParams,
  loadTrustedCaptureProjection,
} from '../lib/lead-capture-convert.ts';

const APP_ROLE = 'expadio_capture_rls_tester';
const APP_ROLE_PASSWORD = 'capture_rls_isolation_test';
const ISSUER = 'https://clerk.expadio.com';

function info() {
  return {
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? 'expadio_test',
  };
}
function superuserPool() {
  return new pg.Pool({ ...info(), user: process.env.PGUSER ?? 'postgres', password: process.env.PGPASSWORD ?? 'postgres', max: 1 });
}
function appPool() {
  return new pg.Pool({ ...info(), user: APP_ROLE, password: APP_ROLE_PASSWORD, max: 1 });
}

async function ensureRole(c: pg.PoolClient) {
  await c.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
      CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$;`);
  await c.query(`ALTER ROLE ${APP_ROLE} WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_ROLE_PASSWORD}'`);
  await c.query(`GRANT USAGE ON SCHEMA platform TO ${APP_ROLE}`);
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO ${APP_ROLE}`);
  await c.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform TO ${APP_ROLE}`);
}

async function org(c: pg.PoolClient, tenantId: string, name: string, parent: string | null = null) {
  const id = randomUUID();
  await c.query(
    `INSERT INTO platform.organizations (organization_id, tenant_id, parent_organization_id, name)
     VALUES ($1, $2, $3, $4)`,
    [id, tenantId, parent, name],
  );
  return id;
}

async function source(c: pg.PoolClient, tenantId: string, organizationId: string, key: string, layer: string) {
  return (await c.query(
    `INSERT INTO platform.lead_capture_sources
       (tenant_id, organization_id, source_key, surface, layer_key, require_signed_ticket)
     VALUES ($1, $2, $3, 'WEBHOOK', $4, false)
     RETURNING source_id`,
    [tenantId, organizationId, key, layer],
  )).rows[0].source_id as string;
}

async function captureLead(c: pg.PoolClient, input: {
  tenantId: string; organizationId: string; sourceId: string; title: string; stage: string; layerPayload: string;
}) {
  return (await c.query(
    `INSERT INTO platform.lead_capture_leads
       (tenant_id, organization_id, source_id, title, email, stage, raw_payload)
     VALUES ($1, $2, $3, $4, 'trusted@example.test', $5, jsonb_build_object('marker',$6::text))
     RETURNING capture_lead_id`,
    [input.tenantId, input.organizationId, input.sourceId, input.title, input.stage, input.layerPayload],
  )).rows[0].capture_lead_id as string;
}

async function setContext(c: pg.PoolClient, input: { tenantId: string; subjectId: string; organizationId: string }) {
  await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [input.tenantId]);
  await c.query(`SELECT set_config('app.subject_id', $1, false)`, [input.subjectId]);
  await c.query(`SELECT set_config('app.issuer', $1, false)`, [ISSUER]);
  await c.query(`SELECT set_config('app.organization_id', $1, false)`, [input.organizationId]);
}

test('trusted Demand Capture inherits organization subtree RLS and projects persisted provenance', async () => {
  const su = superuserPool();
  const admin = await su.connect();
  const tenantId = randomUUID();
  const subjectId = `capture_rls_${randomUUID()}`;
  let app: pg.Pool | null = null;

  try {
    await ensureRole(admin);
    await admin.query(`INSERT INTO platform.tenants (tenant_id, name) VALUES ($1, 'capture-rls')`, [tenantId]);
    const hq = await org(admin, tenantId, 'HQ');
    const countryA = await org(admin, tenantId, 'Country A', hq);
    const unitA = await org(admin, tenantId, 'Unit A', countryA);
    const countryB = await org(admin, tenantId, 'Country B', hq);

    await admin.query(
      `INSERT INTO platform.memberships
         (tenant_id, organization_id, subject_id, issuer, actor_kind, organization_scope_mode)
       VALUES ($1, $2, $3, $4, 'user', 'SELF_AND_DESCENDANTS')`,
      [tenantId, hq, subjectId, ISSUER],
    );

    const unitSource = await source(admin, tenantId, unitA, 'unit-a-webhook', 'unit-a-layer');
    const siblingSource = await source(admin, tenantId, countryB, 'country-b-webhook', 'country-b-layer');
    const unitCapture = await captureLead(admin, {
      tenantId, organizationId: unitA, sourceId: unitSource,
      title: 'Trusted Unit A enquiry', stage: 'APPLICATION_STARTED', layerPayload: 'trusted-unit',
    });
    const siblingCapture = await captureLead(admin, {
      tenantId, organizationId: countryB, sourceId: siblingSource,
      title: 'Sibling enquiry', stage: 'WON', layerPayload: 'sibling',
    });

    app = appPool();
    const c = await app.connect();
    try {
      const priv = await c.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
      assert.equal(priv.rows[0].rolsuper, false);
      assert.equal(priv.rows[0].rolbypassrls, false);

      // Country A narrows HQ membership to Country A + descendants.
      await setContext(c, { tenantId, subjectId, organizationId: countryA });
      const visible = await c.query(`SELECT capture_lead_id FROM platform.lead_capture_leads`);
      assert.deepEqual(visible.rows.map((r) => r.capture_lead_id), [unitCapture]);

      const trusted = await loadTrustedCaptureProjection(c, { tenantId, captureLeadId: unitCapture });
      assert.ok(trusted);
      assert.equal(trusted.organizationId, unitA, 'projection keeps the captured descendant organization');
      assert.equal(trusted.snapshot.captureStage, 'APPLICATION_STARTED');
      assert.equal(trusted.snapshot.captureLayerId, 'unit-a-layer');
      assert.deepEqual(trusted.snapshot.rawPayload, { marker: 'trusted-unit' });

      const hiddenSibling = await loadTrustedCaptureProjection(c, { tenantId, captureLeadId: siblingCapture });
      assert.equal(hiddenSibling, null, 'sibling capture must be invisible in selected Country A workspace');

      // Selected Country A may not forge a Country B capture source.
      await assert.rejects(
        c.query(
          `INSERT INTO platform.lead_capture_sources
             (tenant_id, organization_id, source_key, surface, require_signed_ticket)
           VALUES ($1, $2, 'forged-sibling', 'WEBHOOK', false)`,
          [tenantId, countryB],
        ),
        (err: unknown) => (err as { code?: string }).code === '42501',
      );

      const requestContext = {
        subjectId,
        tenantId,
        organizationId: countryA,
        platformScope: false,
        applyTo: async () => undefined,
      };
      const write = buildTrustedCaptureConvertWrite(trusted, requestContext);
      assert.equal(write.input.stage, 'PROPOSAL');
      assert.equal(write.organizationId, unitA);
      const projected = await c.query(
        UPSERT_CAPTURE_CRM_LEAD_SQL,
        captureConvertBindParams(tenantId, write.organizationId, write.ownerSubjectId, write.input),
      );
      assert.equal(projected.rows[0].organization_id, unitA);
      assert.equal(projected.rows[0].capture_layer_id, 'unit-a-layer');
      assert.equal(projected.rows[0].stage, 'PROPOSAL');

      // Raw submissions are append-only even for an authorized organization.
      const submissionId = (await c.query(
        `INSERT INTO platform.lead_capture_submissions
           (tenant_id, organization_id, source_id, capture_lead_id, idempotency_key, raw_payload)
         VALUES ($1, $2, $3, $4, 'idem-1', '{"persisted":true}'::jsonb)
         RETURNING submission_id`,
        [tenantId, unitA, unitSource, unitCapture],
      )).rows[0].submission_id as string;
      await assert.rejects(
        c.query(`UPDATE platform.lead_capture_submissions SET raw_payload = '{}'::jsonb WHERE submission_id = $1`, [submissionId]),
        /append-only/,
      );
    } finally {
      c.release();
    }
  } finally {
    await admin.query(`DELETE FROM platform.crm_leads WHERE tenant_id = $1`, [tenantId]);
    await admin.query(`DELETE FROM platform.lead_capture_submissions WHERE tenant_id = $1`, [tenantId]).catch(() => undefined);
    // Disable the append-only trigger only for superuser integration cleanup.
    await admin.query(`ALTER TABLE platform.lead_capture_submissions DISABLE TRIGGER lead_capture_submissions_append_only`).catch(() => undefined);
    await admin.query(`DELETE FROM platform.lead_capture_submissions WHERE tenant_id = $1`, [tenantId]).catch(() => undefined);
    await admin.query(`ALTER TABLE platform.lead_capture_submissions ENABLE TRIGGER lead_capture_submissions_append_only`).catch(() => undefined);
    await admin.query(`DELETE FROM platform.lead_capture_leads WHERE tenant_id = $1`, [tenantId]);
    await admin.query(`DELETE FROM platform.lead_capture_sources WHERE tenant_id = $1`, [tenantId]);
    await admin.query(`DELETE FROM platform.memberships WHERE tenant_id = $1`, [tenantId]);
    await admin.query(`DELETE FROM platform.organizations WHERE tenant_id = $1`, [tenantId]);
    await admin.query(`DELETE FROM platform.tenants WHERE tenant_id = $1`, [tenantId]);
    admin.release();
    await su.end();
    if (app) await app.end();
  }
});
