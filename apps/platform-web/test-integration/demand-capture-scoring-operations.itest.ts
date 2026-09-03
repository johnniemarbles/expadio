import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { generatePublishableKey } from '../lib/lead-capture-public-source.ts';
import { calculateAndPersistDemandCaptureScore } from '../../brand-web/lib/demand-capture-scoring.ts';

const APP_ROLE = 'expadio_capture_scoring_ops_tester';
const APP_ROLE_PASSWORD = 'capture_scoring_ops_test';
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

test('Demand Capture score recalculation is deterministic and replay-safe', async () => {
  const su = superuserPool();
  const admin = await su.connect();
  const tenantId = randomUUID();
  const organizationId = randomUUID();
  const subjectId = `capture_scoring_ops_${randomUUID()}`;
  let app: pg.Pool | null = null;
  try {
    await ensureRole(admin);
    await admin.query(`INSERT INTO platform.tenants (tenant_id,name) VALUES ($1,'capture-scoring-ops')`, [tenantId]);
    await admin.query(`INSERT INTO platform.organizations (organization_id,tenant_id,name) VALUES ($1,$2,'Scoring Ops Org')`, [organizationId, tenantId]);
    await admin.query(
      `INSERT INTO platform.memberships
         (tenant_id,organization_id,subject_id,issuer,actor_kind,organization_scope_mode)
       VALUES ($1,$2,$3,$4,'user','SELF')`,
      [tenantId, organizationId, subjectId, ISSUER],
    );
    const sourceId = (await admin.query(
      `INSERT INTO platform.lead_capture_sources
         (tenant_id,organization_id,source_key,surface,require_signed_ticket,status,verification_algorithm,channel,trust_rail,publishable_key,allowed_origins)
       VALUES ($1,$2,'scoring-ops-source','FORM',false,'ACTIVE','ED25519','WEB','PUBLIC',$3, ARRAY['https://example.com']) RETURNING source_id`,
      [tenantId, organizationId, generatePublishableKey()],
    )).rows[0].source_id as string;
    const captureLeadId = (await admin.query(
      `INSERT INTO platform.lead_capture_leads
         (tenant_id,organization_id,source_id,title,stage,status,raw_payload)
       VALUES ($1,$2,$3,'Scoring operations lead','QUALIFICATION','ACTIVE','{}'::jsonb)
       RETURNING capture_lead_id`,
      [tenantId, organizationId, sourceId],
    )).rows[0].capture_lead_id as string;
    const templateId = (await admin.query(
      `INSERT INTO platform.lead_qualification_templates (
         tenant_id,organization_id,template_key,name,version,criteria,status,
         created_by_subject_id,activated_at
       ) VALUES (
         $1,$2,'default','Default qualification',1,
         '[{"key":"fit"},{"key":"readiness"}]'::jsonb,
         'ACTIVE','itest',clock_timestamp()
       ) RETURNING qualification_template_id`,
      [tenantId, organizationId],
    )).rows[0].qualification_template_id as string;
    await admin.query(
      `INSERT INTO platform.lead_scoring_profiles (
         tenant_id,organization_id,profile_key,name,version,components,band_thresholds,
         status,created_by_subject_id,activated_at
       ) VALUES (
         $1,$2,'default','Default score',1,
         '[
           {"key":"fit","criterionKey":"fit","weight":1,"pointsPossible":60,"responsePoints":{"MEETS":60,"PARTIALLY_MEETS":30,"DOES_NOT_MEET":0}},
           {"key":"readiness","criterionKey":"readiness","weight":2,"pointsPossible":20,"responsePoints":{"MEETS":20,"PARTIALLY_MEETS":10,"DOES_NOT_MEET":0}}
         ]'::jsonb,
         '{"HOT":80,"WARM":40,"COLD":0}'::jsonb,
         'ACTIVE','itest',clock_timestamp()
       )`,
      [tenantId, organizationId],
    );
    await admin.query(
      `INSERT INTO platform.lead_qualifications (
         tenant_id,organization_id,capture_lead_id,qualification_template_id,
         template_version,criterion_key,response,note,assessed_by_subject_id,assessed_at
       ) VALUES
         ($1,$2,$3,$4,1,'fit','MEETS','fit evidence','itest',clock_timestamp()-interval '2 seconds'),
         ($1,$2,$3,$4,1,'readiness','PARTIALLY_MEETS','readiness evidence','itest',clock_timestamp()-interval '1 second')`,
      [tenantId, organizationId, captureLeadId, templateId],
    );

    app = appPool();
    const c = await app.connect();
    try {
      const privilege = await c.query(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`);
      assert.equal(privilege.rows[0].rolsuper, false);
      assert.equal(privilege.rows[0].rolbypassrls, false);
      await setContext(c, { tenantId, organizationId, subjectId });
      await c.query('BEGIN');

      const first = await calculateAndPersistDemandCaptureScore(c, {
        tenantId,
        captureLeadId,
        actorSubjectId: subjectId,
      });
      assert.ok(first);
      assert.equal(first.totalScore, 80);
      assert.equal(first.band, 'HOT');
      assert.equal(first.replayed, false);

      const firstComponents = await c.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM platform.lead_score_components WHERE score_id=$1::uuid`,
        [first.scoreId],
      );
      assert.equal(firstComponents.rows[0].count, 2);

      const replay = await calculateAndPersistDemandCaptureScore(c, {
        tenantId,
        captureLeadId,
        actorSubjectId: subjectId,
      });
      assert.ok(replay);
      assert.equal(replay.replayed, true);
      assert.equal(replay.scoreId, first.scoreId);
      assert.equal(replay.calculationFingerprint, first.calculationFingerprint);
      const replayCount = await c.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM platform.lead_scores WHERE capture_lead_id=$1::uuid`,
        [captureLeadId],
      );
      assert.equal(replayCount.rows[0].count, 1);

      await c.query(
        `INSERT INTO platform.lead_qualifications (
           tenant_id,organization_id,capture_lead_id,qualification_template_id,
           template_version,criterion_key,response,note,assessed_by_subject_id
         ) VALUES ($1,$2,$3,$4,1,'readiness','MEETS','readiness improved',$5)`,
        [tenantId, organizationId, captureLeadId, templateId, subjectId],
      );
      const changed = await calculateAndPersistDemandCaptureScore(c, {
        tenantId,
        captureLeadId,
        actorSubjectId: subjectId,
      });
      assert.ok(changed);
      assert.equal(changed.replayed, false);
      assert.notEqual(changed.scoreId, first.scoreId);
      assert.notEqual(changed.calculationFingerprint, first.calculationFingerprint);
      assert.equal(changed.totalScore, 100);
      assert.equal(changed.band, 'HOT');

      const snapshots = await c.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM platform.lead_scores WHERE capture_lead_id=$1::uuid`,
        [captureLeadId],
      );
      assert.equal(snapshots.rows[0].count, 2);
      const componentCount = await c.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM platform.lead_score_components component
           JOIN platform.lead_scores score
             ON score.score_id=component.score_id
            AND score.tenant_id=component.tenant_id
            AND score.organization_id=component.organization_id
          WHERE score.capture_lead_id=$1::uuid`,
        [captureLeadId],
      );
      assert.equal(componentCount.rows[0].count, 4);

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
