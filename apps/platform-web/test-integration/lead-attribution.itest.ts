import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { generatePublishableKey } from '../lib/lead-capture-public-source.ts';
import { persistCaptureAttributionAndConsent } from '../lib/lead-attribution.ts';

// Gate 2 proof: attribution is an append-only touch log (first-touch fixed,
// latest-touch advances), consent is captured, and both are append-only.

const APP_ROLE = 'expadio_attribution_tester';
const APP_ROLE_PASSWORD = 'attribution_isolation_test';

function connectInfo() {
  return { host: process.env.PGHOST ?? 'localhost', port: Number(process.env.PGPORT ?? 5432), database: process.env.PGDATABASE ?? 'expadio_test' };
}
const superuserPool = () => new pg.Pool({ ...connectInfo(), user: process.env.PGUSER ?? 'postgres', password: process.env.PGPASSWORD ?? 'postgres', max: 1 });
const appRolePool = () => new pg.Pool({ ...connectInfo(), user: APP_ROLE, password: APP_ROLE_PASSWORD, max: 1 });

async function ensureAppRole(su: pg.PoolClient): Promise<void> {
  await su.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${APP_ROLE}') THEN CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$;`);
  await su.query(`ALTER ROLE ${APP_ROLE} WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_ROLE_PASSWORD}'`);
  await su.query(`GRANT USAGE ON SCHEMA platform TO ${APP_ROLE}`);
  await su.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO ${APP_ROLE}`);
  await su.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform TO ${APP_ROLE}`);
}

test('attribution touches append; first-touch stays fixed while latest advances', async () => {
  const su = superuserPool();
  const app = appRolePool();
  const suc = await su.connect();
  try {
    await ensureAppRole(suc);
    const tenantId = randomUUID();
    const organizationId = randomUUID();
    const sourceId = randomUUID();
    await suc.query(`INSERT INTO platform.organizations (organization_id, tenant_id, parent_organization_id, name) VALUES ($1,$2,NULL,'Attr Org')`, [organizationId, tenantId]);
    await suc.query(
      `INSERT INTO platform.lead_capture_sources (source_id, tenant_id, organization_id, source_key, surface, require_signed_ticket, status, verification_algorithm, channel, trust_rail, publishable_key, allowed_origins)
       VALUES ($1,$2,$3,'attr-src','FORM',false,'ACTIVE','ED25519','WEB','PUBLIC',$4, ARRAY['https://example.com'])`,
      [sourceId, tenantId, organizationId, generatePublishableKey()],
    );

    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      await c.query("SELECT set_config('app.lead_capture_public_source_id', $1, true)", [sourceId]);

      const contactId = randomUUID();
      await c.query(`INSERT INTO platform.lead_contacts (contact_id, tenant_id, organization_id, email, email_key, status) VALUES ($1,$2,$3,'a@b.com','a@b.com','ACTIVE')`, [contactId, tenantId, organizationId]);
      const captureLeadId = randomUUID();
      await c.query(`INSERT INTO platform.lead_capture_leads (capture_lead_id, tenant_id, organization_id, source_id, title, email, stage, status, verification_state, raw_payload, contact_id) VALUES ($1,$2,$3,$4,'t','a@b.com','NEW_ENQUIRY','ACTIVE','UNVERIFIED','{}'::jsonb,$5)`, [captureLeadId, tenantId, organizationId, sourceId, contactId]);

      await persistCaptureAttributionAndConsent(c, {
        tenantId, organizationId, captureLeadId, contactId, sourceKey: 'attr-src',
        attribution: { utmSource: 'newsletter', pageUrl: 'https://example.com/apply' },
        consent: [{ channel: 'EMAIL', purpose: 'MARKETING', granted: true, textVersion: 'v3' }],
        occurredAt: '2026-09-01T00:00:00.000Z',
      });
      await persistCaptureAttributionAndConsent(c, {
        tenantId, organizationId, captureLeadId, contactId, sourceKey: 'attr-src-2',
        attribution: { utmSource: 'ads' }, consent: [], occurredAt: '2026-09-02T00:00:00.000Z',
      });

      const events = await c.query(`SELECT source_key FROM platform.lead_attribution_events WHERE capture_lead_id=$1::uuid ORDER BY occurred_at ASC`, [captureLeadId]);
      assert.equal(events.rowCount, 2);
      const consent = await c.query(`SELECT granted FROM platform.lead_consent_records WHERE capture_lead_id=$1::uuid`, [captureLeadId]);
      assert.equal(consent.rowCount, 1);
      assert.equal(consent.rows[0].granted, true);

      const contact = await c.query(`SELECT first_source_key, last_source_key FROM platform.lead_contacts WHERE contact_id=$1::uuid`, [contactId]);
      assert.equal(contact.rows[0].first_source_key, 'attr-src', 'first-touch is fixed');
      assert.equal(contact.rows[0].last_source_key, 'attr-src-2', 'latest-touch advances');

      await assert.rejects(
        c.query(`UPDATE platform.lead_attribution_events SET utm_source='tampered' WHERE capture_lead_id=$1::uuid`, [captureLeadId]),
        /append-only/,
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
