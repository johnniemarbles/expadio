import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { generatePublishableKey } from '../lib/lead-capture-public-source.ts';

const APP_ROLE = 'expadio_capture_lifecycle_tester';
const APP_ROLE_PASSWORD = 'capture_lifecycle_test';
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
  await c.query(`SELECT set_config('app.tenant_id',$1,false)`, [input.tenantId]);
  await c.query(`SELECT set_config('app.organization_id',$1,false)`, [input.organizationId]);
  await c.query(`SELECT set_config('app.subject_id',$1,false)`, [input.subjectId]);
  await c.query(`SELECT set_config('app.issuer',$1,false)`, [ISSUER]);
}

async function setTransitionContext(c: pg.PoolClient, actor: string, reason = '', closeReason = '') {
  await c.query(`SELECT set_config('app.lead_capture_transition_actor',$1,true),
                        set_config('app.lead_capture_transition_reason',$2,true),
                        set_config('app.lead_capture_close_reason',$3,true)`,
    [actor, reason, closeReason]);
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

test('Demand Capture stage and operational status lifecycle is governed, atomic and append-only', async () => {
  const su = superuserPool();
  const admin = await su.connect();
  const tenantId = randomUUID();
  const organizationId = randomUUID();
  const subjectId = `capture_lifecycle_${randomUUID()}`;
  let app: pg.Pool | null = null;

  try {
    await ensureRole(admin);
    await admin.query(`INSERT INTO platform.tenants (tenant_id,name) VALUES ($1,'capture-lifecycle')`, [tenantId]);
    await admin.query(`INSERT INTO platform.organizations (organization_id,tenant_id,name) VALUES ($1,$2,'Capture Org')`, [organizationId, tenantId]);
    await admin.query(
      `INSERT INTO platform.memberships
         (tenant_id, organization_id, subject_id, issuer, actor_kind, organization_scope_mode)
       VALUES ($1,$2,$3,$4,'user','SELF_AND_DESCENDANTS')`,
      [tenantId, organizationId, subjectId, ISSUER],
    );
    const sourceId = (await admin.query(
      `INSERT INTO platform.lead_capture_sources
         (tenant_id,organization_id,source_key,surface,require_signed_ticket,status,verification_algorithm,channel,trust_rail,publishable_key,allowed_origins)
       VALUES ($1,$2,'lifecycle-seed','FORM',false,'ACTIVE','ED25519','WEB','PUBLIC',$3, ARRAY['https://example.com']) RETURNING source_id`,
      [tenantId, organizationId, generatePublishableKey()],
    )).rows[0].source_id as string;
    const captureLeadId = (await admin.query(
      `INSERT INTO platform.lead_capture_leads
         (tenant_id,organization_id,source_id,title,stage,status,raw_payload)
       VALUES ($1,$2,$3,'Lifecycle lead','NEW_ENQUIRY','ACTIVE','{}'::jsonb)
       RETURNING capture_lead_id`,
      [tenantId, organizationId, sourceId],
    )).rows[0].capture_lead_id as string;

    app = appPool();
    const c = await app.connect();
    try {
      const priv = await c.query(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`);
      assert.equal(priv.rows[0].rolsuper, false);
      assert.equal(priv.rows[0].rolbypassrls, false);
      await setContext(c, { tenantId, organizationId, subjectId });
      await c.query('BEGIN');

      await setTransitionContext(c, subjectId);
      const first = await c.query(
        `UPDATE platform.lead_capture_leads SET stage='CONTACT_ATTEMPTED',updated_at=now()
          WHERE tenant_id=$1 AND capture_lead_id=$2 RETURNING stage,status`,
        [tenantId, captureLeadId],
      );
      assert.equal(first.rows[0].stage, 'CONTACT_ATTEMPTED');
      assert.equal(first.rows[0].status, 'ACTIVE');
      const firstHistory = await c.query(
        `SELECT from_stage,to_stage,transition_kind,actor_subject_id
           FROM platform.lead_capture_stage_history WHERE capture_lead_id=$1`,
        [captureLeadId],
      );
      assert.deepEqual(firstHistory.rows[0], {
        from_stage: 'NEW_ENQUIRY',
        to_stage: 'CONTACT_ATTEMPTED',
        transition_kind: 'STANDARD',
        actor_subject_id: subjectId,
      });

      await setTransitionContext(c, subjectId);
      await expectRejectedAtSavepoint(
        c,
        'skip_without_reason',
        () => c.query(`UPDATE platform.lead_capture_leads SET stage='QUALIFIED' WHERE capture_lead_id=$1`, [captureLeadId]),
        (error: unknown) => (error as { code?: string }).code === '23514',
      );

      await setTransitionContext(c, subjectId, 'Qualification completed outside the standard sequence');
      await c.query(`UPDATE platform.lead_capture_leads SET stage='QUALIFIED',updated_at=now() WHERE capture_lead_id=$1`, [captureLeadId]);
      const override = await c.query(
        `SELECT transition_kind,reason FROM platform.lead_capture_stage_history
          WHERE capture_lead_id=$1 ORDER BY changed_at DESC,stage_history_id DESC LIMIT 1`,
        [captureLeadId],
      );
      assert.equal(override.rows[0].transition_kind, 'OVERRIDE');
      assert.equal(override.rows[0].reason, 'Qualification completed outside the standard sequence');

      await setTransitionContext(c, subjectId, 'Waiting for requested documents');
      await c.query(`UPDATE platform.lead_capture_leads SET status='WAITING_ON_LEAD',updated_at=now() WHERE capture_lead_id=$1`, [captureLeadId]);
      const waiting = await c.query(`SELECT stage,status FROM platform.lead_capture_leads WHERE capture_lead_id=$1`, [captureLeadId]);
      assert.deepEqual(waiting.rows[0], { stage: 'QUALIFIED', status: 'WAITING_ON_LEAD' });
      const statusHistory = await c.query(
        `SELECT from_status,to_status,reason FROM platform.lead_capture_status_history
          WHERE capture_lead_id=$1 ORDER BY changed_at DESC,status_history_id DESC LIMIT 1`,
        [captureLeadId],
      );
      assert.deepEqual(statusHistory.rows[0], {
        from_status: 'ACTIVE',
        to_status: 'WAITING_ON_LEAD',
        reason: 'Waiting for requested documents',
      });

      await setTransitionContext(c, subjectId, 'Opportunity ended', '');
      await expectRejectedAtSavepoint(
        c,
        'terminal_without_close_reason',
        () => c.query(`UPDATE platform.lead_capture_leads SET stage='LOST' WHERE capture_lead_id=$1`, [captureLeadId]),
        (error: unknown) => (error as { code?: string }).code === '23514',
      );

      await setTransitionContext(c, subjectId, 'Opportunity ended', 'NO_BUDGET');
      const terminal = await c.query(
        `UPDATE platform.lead_capture_leads SET stage='LOST',updated_at=now()
          WHERE capture_lead_id=$1 RETURNING stage,status,close_reason_code,closed_at`,
        [captureLeadId],
      );
      assert.equal(terminal.rows[0].stage, 'LOST');
      assert.equal(terminal.rows[0].status, 'LOST');
      assert.equal(terminal.rows[0].close_reason_code, 'NO_BUDGET');
      assert.ok(terminal.rows[0].closed_at);

      const terminalStatusHistory = await c.query(
        `SELECT from_status,to_status,reason FROM platform.lead_capture_status_history
          WHERE capture_lead_id=$1 ORDER BY changed_at DESC,status_history_id DESC LIMIT 1`,
        [captureLeadId],
      );
      assert.equal(terminalStatusHistory.rows[0].from_status, 'WAITING_ON_LEAD');
      assert.equal(terminalStatusHistory.rows[0].to_status, 'LOST');

      await setTransitionContext(c, subjectId, 'Attempted status-only reopen');
      await expectRejectedAtSavepoint(
        c,
        'terminal_status_mismatch',
        () => c.query(`UPDATE platform.lead_capture_leads SET status='ACTIVE' WHERE capture_lead_id=$1`, [captureLeadId]),
        (error: unknown) => (error as { code?: string }).code === '23514'
          && String((error as Error).message).includes('aligned operational status'),
      );

      const historyId = (await c.query(
        `SELECT stage_history_id FROM platform.lead_capture_stage_history
          WHERE capture_lead_id=$1 ORDER BY changed_at DESC LIMIT 1`,
        [captureLeadId],
      )).rows[0].stage_history_id as string;
      const tamper = await c.query(
        `UPDATE platform.lead_capture_stage_history SET reason='tampered' WHERE stage_history_id=$1`,
        [historyId],
      );
      assert.equal(tamper.rowCount, 0, 'Brand/app role must have no lifecycle-history mutation path through RLS');

      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  } finally {
    // All lifecycle mutations above are deliberately rolled back, so no history
    // survives to require trigger bypass during cleanup. Never disable immutable
    // history triggers in the shared integration database.
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
