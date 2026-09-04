import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { generatePublishableKey } from '../lib/lead-capture-public-source.ts';

const APP_ROLE = 'expadio_capture_scoring_tester';
const APP_ROLE_PASSWORD = 'capture_scoring_test';
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
async function setContext(c: pg.PoolClient, input: { tenantId: string; organizationId: string; subjectId: string }) {
  await c.query(
    `SELECT set_config('app.tenant_id',$1,false),
            set_config('app.organization_id',$2,false),
            set_config('app.subject_id',$3,false),
            set_config('app.issuer',$4,false)`,
    [input.tenantId, input.organizationId, input.subjectId, ISSUER],
  );
}

async function expectRejectedAtSavepoint(
  c: pg.PoolClient,
  name: string,
  operation: () => Promise<unknown>,
  validator: (error: unknown) => boolean,
) {
  await c.query(`SAVEPOINT ${name}`);
  try {
    await assert.rejects(operation(), validator);
  } finally {
    await c.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await c.query(`RELEASE SAVEPOINT ${name}`);
  }
}

test('Demand Capture scoring evidence is organization-scoped and immutable', async () => {
  const su = superuserPool();
  const admin = await su.connect();
  const tenantId = randomUUID();
  const organizationId = randomUUID();
  const siblingOrganizationId = randomUUID();
  const subjectId = `capture_scoring_${randomUUID()}`;
  let app: pg.Pool | null = null;
  try {
    await ensureRole(admin);
    await admin.query(`INSERT INTO platform.tenants (tenant_id,name) VALUES ($1,'capture-scoring')`, [tenantId]);
    await admin.query(
      `INSERT INTO platform.organizations (organization_id,tenant_id,name) VALUES
       ($1,$3,'Scoring Org'),($2,$3,'Sibling Org')`,
      [organizationId, siblingOrganizationId, tenantId],
    );
    await admin.query(
      `INSERT INTO platform.memberships
         (tenant_id,organization_id,subject_id,issuer,actor_kind,organization_scope_mode)
       VALUES ($1,$2,$3,$4,'user','SELF')`,
      [tenantId, organizationId, subjectId, ISSUER],
    );
    const sourceId = (await admin.query(
      `INSERT INTO platform.lead_capture_sources
         (tenant_id,organization_id,source_key,surface,require_signed_ticket,status,verification_algorithm,channel,trust_rail,publishable_key,allowed_origins)
       VALUES ($1,$2,'scoring-source','FORM',false,'ACTIVE','ED25519','WEB','PUBLIC',$3, ARRAY['https://example.com']) RETURNING source_id`,
      [tenantId, organizationId, generatePublishableKey()],
    )).rows[0].source_id as string;
    const captureLeadId = (await admin.query(
      `INSERT INTO platform.lead_capture_leads
         (tenant_id,organization_id,source_id,title,stage,status,raw_payload)
       VALUES ($1,$2,$3,'Scoring lead','QUALIFICATION','ACTIVE','{}'::jsonb)
       RETURNING capture_lead_id`,
      [tenantId, organizationId, sourceId],
    )).rows[0].capture_lead_id as string;
    const siblingSourceId = (await admin.query(
      `INSERT INTO platform.lead_capture_sources
         (tenant_id,organization_id,source_key,surface,require_signed_ticket,status,verification_algorithm,channel,trust_rail,publishable_key,allowed_origins)
       VALUES ($1,$2,'sibling-scoring-source','FORM',false,'ACTIVE','ED25519','WEB','PUBLIC',$3, ARRAY['https://example.com']) RETURNING source_id`,
      [tenantId, siblingOrganizationId, generatePublishableKey()],
    )).rows[0].source_id as string;
    await admin.query(
      `INSERT INTO platform.lead_capture_leads
         (tenant_id,organization_id,source_id,title,stage,status,raw_payload)
       VALUES ($1,$2,$3,'Sibling scoring lead','QUALIFICATION','ACTIVE','{}'::jsonb)`,
      [tenantId, siblingOrganizationId, siblingSourceId],
    );

    app = appPool();
    const c = await app.connect();
    try {
      const priv = await c.query(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`);
      assert.equal(priv.rows[0].rolsuper, false);
      assert.equal(priv.rows[0].rolbypassrls, false);
      await setContext(c, { tenantId, organizationId, subjectId });
      await c.query('BEGIN');

      const profileId = (await c.query(
        `INSERT INTO platform.lead_scoring_profiles (
           tenant_id,organization_id,profile_key,name,version,components,band_thresholds,
           status,created_by_subject_id,activated_at
         ) VALUES (
           $1,$2,'default','Default qualification score',1,
           '[{"key":"fit","weight":1}]'::jsonb,
           '{"HOT":80,"WARM":50,"COLD":0}'::jsonb,
           'ACTIVE',$3,clock_timestamp()
         ) RETURNING scoring_profile_id`,
        [tenantId, organizationId, subjectId],
      )).rows[0].scoring_profile_id as string;

      await expectRejectedAtSavepoint(
        c,
        'duplicate_active_profile',
        () => c.query(
          `INSERT INTO platform.lead_scoring_profiles (
             tenant_id,organization_id,profile_key,name,version,components,band_thresholds,
             status,created_by_subject_id,activated_at
           ) VALUES ($1,$2,'default','Second active',2,'[]'::jsonb,'{}'::jsonb,'ACTIVE',$3,clock_timestamp())`,
          [tenantId, organizationId, subjectId],
        ),
        (error: unknown) => (error as { code?: string }).code === '23505',
      );

      const qualificationId = (await c.query(
        `INSERT INTO platform.lead_qualification_templates (
           tenant_id,organization_id,template_key,name,version,criteria,status,created_by_subject_id,activated_at
         ) VALUES ($1,$2,'default','Default qualification',1,
           '[{"key":"fit"}]'::jsonb,'ACTIVE',$3,clock_timestamp())
         RETURNING qualification_template_id`,
        [tenantId, organizationId, subjectId],
      )).rows[0].qualification_template_id as string;
      await c.query(
        `INSERT INTO platform.lead_qualifications (
           tenant_id,organization_id,capture_lead_id,qualification_template_id,template_version,
           criterion_key,response,note,assessed_by_subject_id,evidence_source
         ) VALUES ($1,$2,$3,$4,1,'fit','MEETS','Strong fit',$5,'OPERATOR_ASSESSED')`,
        [tenantId, organizationId, captureLeadId, qualificationId, subjectId],
      );

      const scoreId = (await c.query(
        `INSERT INTO platform.lead_scores (
           tenant_id,organization_id,capture_lead_id,scoring_profile_id,profile_version,
           total_score,band,calculated_by_subject_id,calculation_reason
         ) VALUES ($1,$2,$3,$4,1,92,'HOT',$5,'Deterministic qualification calculation')
         RETURNING score_id`,
        [tenantId, organizationId, captureLeadId, profileId, subjectId],
      )).rows[0].score_id as string;
      await c.query(
        `INSERT INTO platform.lead_score_components (
           tenant_id,organization_id,score_id,component_key,raw_value,weight,
           points_awarded,points_possible,explanation
         ) VALUES ($1,$2,$3,'fit','"MEETS"'::jsonb,1,92,100,'Qualification criterion met')`,
        [tenantId, organizationId, scoreId],
      );

      const visible = await c.query(`SELECT count(*)::int AS count FROM platform.lead_scores WHERE tenant_id=$1`, [tenantId]);
      assert.equal(visible.rows[0].count, 1);
      const siblingVisible = await c.query(
        `SELECT count(*)::int AS count FROM platform.lead_capture_leads WHERE organization_id=$1`,
        [siblingOrganizationId],
      );
      assert.equal(siblingVisible.rows[0].count, 0);

      const scoreTamper = await c.query(
        `UPDATE platform.lead_scores SET total_score=1 WHERE score_id=$1`,
        [scoreId],
      );
      assert.equal(scoreTamper.rowCount, 0, 'app role must have no score mutation path through RLS');
      const qualificationTamper = await c.query(
        `UPDATE platform.lead_qualifications SET note='tampered' WHERE capture_lead_id=$1`,
        [captureLeadId],
      );
      assert.equal(qualificationTamper.rowCount, 0, 'app role must have no qualification mutation path through RLS');

      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  } finally {
    await admin.query(`DELETE FROM platform.lead_score_components WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
    await admin.query(`DELETE FROM platform.lead_scores WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
    await admin.query(`DELETE FROM platform.lead_scoring_profiles WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
    await admin.query(`DELETE FROM platform.lead_qualifications WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
    await admin.query(`DELETE FROM platform.lead_qualification_templates WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
    await admin.query(`DELETE FROM platform.lead_capture_leads WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
    await admin.query(`DELETE FROM platform.lead_capture_sources WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
    await admin.query(`DELETE FROM platform.memberships WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
    await admin.query(`DELETE FROM platform.organizations WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
    await admin.query(`DELETE FROM platform.tenants WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
    admin.release();
    await su.end();
    if (app) await app.end();
  }
});
