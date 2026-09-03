import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { canonicalCaptureSignaturePayload, verifyCaptureSignature } from '../lib/lead-capture-ingress.ts';

const APP_ROLE = 'expadio_capture_ingress_tester';
const APP_ROLE_PASSWORD = 'capture_ingress_isolation_test';

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

async function org(c: pg.PoolClient, tenantId: string, name: string) {
  const organizationId = randomUUID();
  await c.query(`INSERT INTO platform.organizations (organization_id, tenant_id, name) VALUES ($1,$2,$3)`, [organizationId, tenantId, name]);
  return organizationId;
}

async function signedSource(c: pg.PoolClient, input: {
  tenantId: string; organizationId: string; sourceKey: string; publicKeyPem: string;
}) {
  return (await c.query(
    `INSERT INTO platform.lead_capture_sources
       (tenant_id, organization_id, source_key, surface, layer_key, require_signed_ticket,
        status, verification_algorithm, verification_public_key, verification_key_id)
     VALUES ($1,$2,$3,'WEBHOOK','signed-layer',true,'ACTIVE','ED25519',$4,'itest-key')
     RETURNING source_id`,
    [input.tenantId, input.organizationId, input.sourceKey, input.publicKeyPem],
  )).rows[0].source_id as string;
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

test('signed ingress is source-bound, idempotent and cannot choose organization or stage', async () => {
  const su = superuserPool();
  const admin = await su.connect();
  const tenantId = randomUUID();
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  let app: pg.Pool | null = null;

  try {
    await ensureRole(admin);
    await admin.query(`INSERT INTO platform.tenants (tenant_id, name) VALUES ($1,'capture-ingress')`, [tenantId]);
    const orgA = await org(admin, tenantId, 'Org A');
    const orgB = await org(admin, tenantId, 'Org B');
    const sourceA = await signedSource(admin, { tenantId, organizationId: orgA, sourceKey: 'signed-a', publicKeyPem });
    const sourceB = await signedSource(admin, { tenantId, organizationId: orgB, sourceKey: 'signed-b', publicKeyPem });

    const raw = new TextEncoder().encode(JSON.stringify({ title: 'Signed enquiry', email: 'signed@example.test', stage: 'WON', organizationId: orgB }));
    const timestamp = `${Math.floor(Date.now() / 1000)}`;
    const signature = sign(null, canonicalCaptureSignaturePayload(timestamp, raw), privateKey).toString('base64');
    assert.equal(verifyCaptureSignature({ publicKeyPem, signatureBase64: signature, timestamp, rawBody: raw, maxClockSkewSeconds: 300 }), true);

    app = appPool();
    const c = await app.connect();
    try {
      const priv = await c.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
      assert.equal(priv.rows[0].rolsuper, false);
      assert.equal(priv.rows[0].rolbypassrls, false);

      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenantId]);
      await c.query(`SELECT set_config('app.lead_capture_ingress_source_id',$1,true)`, [sourceA]);

      const visibleSources = await c.query(`SELECT source_id, organization_id FROM platform.lead_capture_sources ORDER BY source_key`);
      assert.deepEqual(visibleSources.rows, [{ source_id: sourceA, organization_id: orgA }]);
      assert.notEqual(sourceA, sourceB);

      const captureLeadId = randomUUID();
      await c.query(
        `INSERT INTO platform.lead_capture_leads
           (capture_lead_id, tenant_id, organization_id, source_id, title, stage, status, raw_payload)
         VALUES ($1,$2,$3,$4,'Signed enquiry','NEW_ENQUIRY','ACTIVE',$5::jsonb)`,
        [captureLeadId, tenantId, orgA, sourceA, Buffer.from(raw).toString('utf8')],
      );

      await expectRejectedAtSavepoint(
        c,
        'forged_org',
        () => c.query(
          `INSERT INTO platform.lead_capture_leads
             (tenant_id, organization_id, source_id, title, stage, status, raw_payload)
           VALUES ($1,$2,$3,'Forged org','NEW_ENQUIRY','ACTIVE','{}'::jsonb)`,
          [tenantId, orgB, sourceA],
        ),
        (error: unknown) => ['42501','23503'].includes((error as { code?: string }).code ?? ''),
      );

      await expectRejectedAtSavepoint(
        c,
        'forged_stage',
        () => c.query(
          `INSERT INTO platform.lead_capture_leads
             (tenant_id, organization_id, source_id, title, stage, status, raw_payload)
           VALUES ($1,$2,$3,'Forged stage','WON','ACTIVE','{}'::jsonb)`,
          [tenantId, orgA, sourceA],
        ),
        (error: unknown) => (error as { code?: string }).code === '42501',
      );

      const submissionId = randomUUID();
      await c.query(
        `INSERT INTO platform.lead_capture_submissions
           (submission_id, tenant_id, organization_id, source_id, capture_lead_id, idempotency_key, raw_payload)
         VALUES ($1,$2,$3,$4,$5,'idem-signed-1',$6::jsonb)`,
        [submissionId, tenantId, orgA, sourceA, captureLeadId, Buffer.from(raw).toString('utf8')],
      );
      await expectRejectedAtSavepoint(
        c,
        'duplicate_idem',
        () => c.query(
          `INSERT INTO platform.lead_capture_submissions
             (tenant_id, organization_id, source_id, capture_lead_id, idempotency_key, raw_payload)
           VALUES ($1,$2,$3,$4,'idem-signed-1','{}'::jsonb)`,
          [tenantId, orgA, sourceA, captureLeadId],
        ),
        (error: unknown) => (error as { code?: string }).code === '23505',
      );
      await assert.rejects(
        c.query(`UPDATE platform.lead_capture_submissions SET raw_payload = '{}'::jsonb WHERE submission_id = $1`, [submissionId]),
        /append-only/,
      );
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  } finally {
    await admin.query(`ALTER TABLE platform.lead_capture_submissions DISABLE TRIGGER lead_capture_submissions_append_only`).catch(() => undefined);
    await admin.query(`DELETE FROM platform.lead_capture_submissions WHERE tenant_id = $1`, [tenantId]).catch(() => undefined);
    await admin.query(`ALTER TABLE platform.lead_capture_submissions ENABLE TRIGGER lead_capture_submissions_append_only`).catch(() => undefined);
    await admin.query(`DELETE FROM platform.lead_capture_leads WHERE tenant_id = $1`, [tenantId]).catch(() => undefined);
    await admin.query(`DELETE FROM platform.lead_capture_sources WHERE tenant_id = $1`, [tenantId]).catch(() => undefined);
    await admin.query(`DELETE FROM platform.organizations WHERE tenant_id = $1`, [tenantId]).catch(() => undefined);
    await admin.query(`DELETE FROM platform.tenants WHERE tenant_id = $1`, [tenantId]).catch(() => undefined);
    admin.release();
    await su.end();
    if (app) await app.end();
  }
});
