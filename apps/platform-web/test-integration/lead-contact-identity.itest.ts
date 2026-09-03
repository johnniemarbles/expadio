import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { generatePublishableKey } from '../lib/lead-capture-public-source.ts';
import { resolveOrCreateLeadContact } from '../lib/lead-contact-resolution.ts';

// Gate 1 behavioral proof: exact-email auto-links (idempotent), a non-exact
// (phone) match enqueues a review candidate — never a silent merge — and the
// identity tables are deny-by-default without the ingress source context.

const APP_ROLE = 'expadio_identity_tester';
const APP_ROLE_PASSWORD = 'identity_isolation_test';

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

async function seed(su: pg.PoolClient) {
  const tenantId = randomUUID();
  const organizationId = randomUUID();
  const sourceId = randomUUID();
  await su.query(`INSERT INTO platform.organizations (organization_id, tenant_id, parent_organization_id, name) VALUES ($1,$2,NULL,$3)`, [organizationId, tenantId, 'Identity Org']);
  await su.query(
    `INSERT INTO platform.lead_capture_sources
       (source_id, tenant_id, organization_id, source_key, surface, require_signed_ticket, status,
        verification_algorithm, channel, trust_rail, publishable_key, allowed_origins)
     VALUES ($1,$2,$3,$4,'FORM',false,'ACTIVE','ED25519','WEB','PUBLIC',$5, ARRAY['https://example.com'])`,
    [sourceId, tenantId, organizationId, `id-${sourceId.slice(0, 8)}`, generatePublishableKey()],
  );
  return { tenantId, organizationId, sourceId };
}

async function setContext(c: pg.PoolClient, tenantId: string, sourceId: string) {
  await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  await c.query("SELECT set_config('app.lead_capture_public_source_id', $1, true)", [sourceId]);
}

test('exact email auto-links idempotently; a phone match enqueues one review candidate', async () => {
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

      const first = await resolveOrCreateLeadContact(c, { tenantId: s.tenantId, organizationId: s.organizationId, email: 'Ada@Example.com', phone: '+1 415 555 0000', firstName: 'Ada' });
      assert.equal(first.created, true);

      // Same email (different case/spacing) → auto-link, no new contact.
      const again = await resolveOrCreateLeadContact(c, { tenantId: s.tenantId, organizationId: s.organizationId, email: ' ada@example.com ', firstName: 'Ada B' });
      assert.equal(again.created, false);
      assert.equal(again.contactId, first.contactId);

      // Different email, same phone → new contact + one PENDING review candidate.
      const third = await resolveOrCreateLeadContact(c, { tenantId: s.tenantId, organizationId: s.organizationId, email: 'grace@example.com', phone: '+14155550000' });
      assert.equal(third.created, true);
      assert.equal(third.candidateCount, 1);

      const candidates = await c.query(
        `SELECT status, confidence FROM platform.lead_contact_duplicate_candidates
          WHERE tenant_id = $1::uuid AND organization_id = $2::uuid`,
        [s.tenantId, s.organizationId],
      );
      assert.equal(candidates.rowCount, 1);
      assert.equal(candidates.rows[0].status, 'PENDING');
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

test('identity tables deny inserts without the ingress source context', async () => {
  const su = superuserPool();
  const app = appRolePool();
  const suc = await su.connect();
  try {
    await ensureAppRole(suc);
    const s = await seed(suc);
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      // No GUC set → deny by default.
      await assert.rejects(
        c.query(
          `INSERT INTO platform.lead_contacts (contact_id, tenant_id, organization_id, email, email_key, status)
           VALUES ($1,$2,$3,'x@y.com','x@y.com','ACTIVE')`,
          [randomUUID(), s.tenantId, s.organizationId],
        ),
        /row-level security|new row violates/i,
      );
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
