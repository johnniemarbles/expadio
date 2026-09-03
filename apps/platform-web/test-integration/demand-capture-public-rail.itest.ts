import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { generatePublishableKey } from '../lib/lead-capture-public-source.ts';
import { generateOtpCode, hashOtp, newOtpSalt, otpExpiry } from '../lib/lead-capture-otp.ts';

// Behavioral proof for migration 0135: the PUBLIC (Rail B) ingress RLS admits a
// parked, UNVERIFIED capture bound to the request-scoped source, blocks anything
// else, and the verify path can only promote UNVERIFIED -> VERIFIED. Runs against
// a migrated PostgreSQL (expadio_test) using a NON-superuser app role so RLS is
// actually exercised (a superuser would bypass it).

const APP_ROLE = 'expadio_public_capture_tester';
const APP_ROLE_PASSWORD = 'public_capture_isolation_test';

function connectInfo() {
  return {
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? 'expadio_test',
  };
}
const superuserPool = () => new pg.Pool({ ...connectInfo(), user: process.env.PGUSER ?? 'postgres', password: process.env.PGPASSWORD ?? 'postgres', max: 1 });
const appRolePool = () => new pg.Pool({ ...connectInfo(), user: APP_ROLE, password: APP_ROLE_PASSWORD, max: 1 });

async function ensureAppRole(su: pg.PoolClient): Promise<void> {
  await su.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
      CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$;`);
  await su.query(`ALTER ROLE ${APP_ROLE} WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_ROLE_PASSWORD}'`);
  await su.query(`GRANT USAGE ON SCHEMA platform TO ${APP_ROLE}`);
  await su.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO ${APP_ROLE}`);
  await su.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform TO ${APP_ROLE}`);
}

async function seed(su: pg.PoolClient): Promise<{ tenantId: string; organizationId: string; sourceId: string; publishableKey: string }> {
  const tenantId = randomUUID();
  const organizationId = randomUUID();
  const sourceId = randomUUID();
  const publishableKey = generatePublishableKey();
  await su.query(`INSERT INTO platform.tenants (tenant_id, name) VALUES ($1, 'Public Capture Tenant') ON CONFLICT DO NOTHING`, [tenantId]);
  await su.query(
    `INSERT INTO platform.organizations (organization_id, tenant_id, parent_organization_id, name)
     VALUES ($1,$2,NULL,$3)`,
    [organizationId, tenantId, 'Public Capture Org'],
  );
  await su.query(
    `INSERT INTO platform.lead_capture_sources
       (source_id, tenant_id, organization_id, source_key, surface, require_signed_ticket, status,
        verification_algorithm, channel, trust_rail, publishable_key, allowed_origins)
     VALUES ($1,$2,$3,$4,'FORM',false,'ACTIVE','ED25519','WEB','PUBLIC',$5, ARRAY['https://example.com'])`,
    [sourceId, tenantId, organizationId, `pub-${sourceId.slice(0, 8)}`, publishableKey],
  );
  return { tenantId, organizationId, sourceId, publishableKey };
}

async function setContext(c: pg.PoolClient, tenantId: string, sourceId: string): Promise<void> {
  await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  await c.query("SELECT set_config('app.lead_capture_public_source_id', $1, true)", [sourceId]);
}

async function insertParkedLead(c: pg.PoolClient, s: { tenantId: string; organizationId: string; sourceId: string }, verificationState = 'UNVERIFIED'): Promise<string> {
  const captureLeadId = randomUUID();
  await c.query(
    `INSERT INTO platform.lead_capture_leads
       (capture_lead_id, tenant_id, organization_id, source_id, title, email, stage, status, verification_state, raw_payload)
     VALUES ($1,$2,$3,$4,$5,$6,'NEW_ENQUIRY','ACTIVE',$7,'{}'::jsonb)`,
    [captureLeadId, s.tenantId, s.organizationId, s.sourceId, 'New enquiry', 'lead@example.com', verificationState],
  );
  return captureLeadId;
}

async function expectReject(fn: () => Promise<unknown>, needle: RegExp): Promise<void> {
  try {
    await fn();
    assert.fail('expected the write to be rejected');
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.match(String((error as { message?: string }).message ?? error), needle);
  }
}

test('public ingress admits a parked lead, then verify promotes it', async () => {
  const su = superuserPool();
  const app = appRolePool();
  const suc = await su.connect();
  try {
    await ensureAppRole(suc);
    const s = await seed(suc);
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await setContext(c, s.tenantId, s.sourceId);
      const captureLeadId = await insertParkedLead(c, s);

      const code = generateOtpCode();
      const salt = newOtpSalt();
      await c.query(
        `INSERT INTO platform.lead_capture_verifications
           (tenant_id, organization_id, source_id, capture_lead_id, channel, destination_hash, code_hash, code_salt, max_attempts, expires_at)
         VALUES ($1,$2,$3,$4,'EMAIL','deadbeef',$5,$6,5,$7)`,
        [s.tenantId, s.organizationId, s.sourceId, captureLeadId, hashOtp(code, salt), salt, otpExpiry().toISOString()],
      );

      const promoted = await c.query(
        `UPDATE platform.lead_capture_leads SET verification_state='VERIFIED', updated_at=now()
          WHERE capture_lead_id=$1 AND verification_state='UNVERIFIED' RETURNING verification_state`,
        [captureLeadId],
      );
      assert.equal(promoted.rowCount, 1);
      assert.equal(promoted.rows[0].verification_state, 'VERIFIED');
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  } finally {
    suc.release();
    await su.end();
    await app.end();
  }
});

test('public ingress rejects a non-parked insert and cross-source spoofing', async () => {
  const su = superuserPool();
  const app = appRolePool();
  const suc = await su.connect();
  try {
    await ensureAppRole(suc);
    const a = await seed(suc);
    const b = await seed(suc);
    const c = await app.connect();
    try {
      // A lead that tries to arrive already-VERIFIED (skipping the OTP gate).
      await c.query('BEGIN');
      await setContext(c, a.tenantId, a.sourceId);
      await expectReject(() => insertParkedLead(c, a, 'VERIFIED'), /row-level security|new row violates/i);
      await c.query('ROLLBACK');

      // Context bound to source A, but the row claims source B.
      await c.query('BEGIN');
      await setContext(c, a.tenantId, a.sourceId);
      await expectReject(
        () => insertParkedLead(c, { tenantId: b.tenantId, organizationId: b.organizationId, sourceId: b.sourceId }),
        /row-level security|new row violates/i,
      );
      await c.query('ROLLBACK');

      // With no ingress context set, deny by default.
      await c.query('BEGIN');
      await expectReject(() => insertParkedLead(c, a), /row-level security|new row violates/i);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  } finally {
    suc.release();
    await su.end();
    await app.end();
  }
});
