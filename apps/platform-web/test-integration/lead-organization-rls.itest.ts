import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

const APP_ROLE = 'expadio_lead_rls_tester';
const APP_ROLE_PASSWORD = 'lead_rls_isolation_test';
const ISSUER = 'https://clerk.expadio.com';

function connectInfo() {
  return {
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? 'expadio_test',
  };
}

function superuserPool(): pg.Pool {
  return new pg.Pool({ ...connectInfo(), user: process.env.PGUSER ?? 'postgres', password: process.env.PGPASSWORD ?? 'postgres', max: 1 });
}

function appRolePool(): pg.Pool {
  return new pg.Pool({ ...connectInfo(), user: APP_ROLE, password: APP_ROLE_PASSWORD, max: 1 });
}

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

async function seedOrganization(
  c: pg.PoolClient,
  tenantId: string,
  name: string,
  parentOrganizationId: string | null = null,
): Promise<string> {
  const organizationId = randomUUID();
  await c.query(
    `INSERT INTO platform.organizations (organization_id, tenant_id, parent_organization_id, name)
     VALUES ($1, $2, $3, $4)`,
    [organizationId, tenantId, parentOrganizationId, name],
  );
  return organizationId;
}

async function seedLead(c: pg.PoolClient, tenantId: string, organizationId: string, title: string): Promise<string> {
  return (await c.query(
    `INSERT INTO platform.crm_leads (tenant_id, organization_id, title, stage, currency, source, raw_payload)
     VALUES ($1, $2, $3, 'NEW', 'USD', 'manual', '{}'::jsonb)
     RETURNING lead_id`,
    [tenantId, organizationId, title],
  )).rows[0].lead_id as string;
}

async function setContext(c: pg.PoolClient, input: { tenantId: string; subjectId: string; organizationId: string }): Promise<void> {
  await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [input.tenantId]);
  await c.query(`SELECT set_config('app.subject_id', $1, false)`, [input.subjectId]);
  await c.query(`SELECT set_config('app.issuer', $1, false)`, [ISSUER]);
  await c.query(`SELECT set_config('app.organization_id', $1, false)`, [input.organizationId]);
}

test('CRM lead RLS enforces selected organization subtree and tenant isolation under a real app role', async () => {
  const su = superuserPool();
  const suc = await su.connect();
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const subjectId = `lead_rls_${randomUUID()}`;
  let app: pg.Pool | null = null;

  try {
    await ensureAppRole(suc);
    await suc.query(`INSERT INTO platform.tenants (tenant_id, name) VALUES ($1, 'lead-rls-a'), ($2, 'lead-rls-b')`, [tenantA, tenantB]);

    const hq = await seedOrganization(suc, tenantA, 'HQ');
    const countryA = await seedOrganization(suc, tenantA, 'Country A', hq);
    const unitA = await seedOrganization(suc, tenantA, 'Unit A', countryA);
    const countryB = await seedOrganization(suc, tenantA, 'Country B', hq);
    const otherTenantOrg = await seedOrganization(suc, tenantB, 'Other tenant HQ');

    await suc.query(
      `INSERT INTO platform.memberships
         (tenant_id, organization_id, subject_id, issuer, actor_kind, organization_scope_mode)
       VALUES ($1, $2, $3, $4, 'user', 'SELF_AND_DESCENDANTS')`,
      [tenantA, hq, subjectId, ISSUER],
    );

    const hqLead = await seedLead(suc, tenantA, hq, 'HQ lead');
    const countryALead = await seedLead(suc, tenantA, countryA, 'Country A lead');
    const unitALead = await seedLead(suc, tenantA, unitA, 'Unit A lead');
    const countryBLead = await seedLead(suc, tenantA, countryB, 'Country B lead');
    await seedLead(suc, tenantB, otherTenantOrg, 'Other tenant lead');

    app = appRolePool();
    const c = await app.connect();
    try {
      const priv = await c.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
      assert.equal(priv.rows[0].rolsuper, false, 'Lead RLS test role must not be a superuser');
      assert.equal(priv.rows[0].rolbypassrls, false, 'Lead RLS test role must not bypass RLS');

      // HQ selection: membership and selected context both permit all descendants.
      await setContext(c, { tenantId: tenantA, subjectId, organizationId: hq });
      const seenFromHq = await c.query(`SELECT lead_id FROM platform.crm_leads ORDER BY title`);
      assert.deepEqual(
        new Set(seenFromHq.rows.map((r) => r.lead_id)),
        new Set([hqLead, countryALead, unitALead, countryBLead]),
        'HQ must see its own lead and authorized descendants',
      );

      // Country A selection narrows the same HQ grant to Country A + descendants.
      await setContext(c, { tenantId: tenantA, subjectId, organizationId: countryA });
      const seenFromCountryA = await c.query(`SELECT lead_id FROM platform.crm_leads ORDER BY title`);
      assert.deepEqual(
        new Set(seenFromCountryA.rows.map((r) => r.lead_id)),
        new Set([countryALead, unitALead]),
        'Country selection must not expose HQ or sibling-country leads',
      );
      assert.equal((await c.query(`SELECT 1 FROM platform.crm_leads WHERE lead_id = $1`, [countryBLead])).rowCount, 0);

      // A sibling write is invisible rather than mutable.
      const siblingUpdate = await c.query(`UPDATE platform.crm_leads SET title = 'hijacked' WHERE lead_id = $1`, [countryBLead]);
      assert.equal(siblingUpdate.rowCount, 0, 'Country A must not update Country B');

      // WITH CHECK: a write stamped into the sibling is denied even though the subject
      // has a broader HQ membership; selected workspace remains a narrowing boundary.
      await assert.rejects(
        c.query(
          `INSERT INTO platform.crm_leads (tenant_id, organization_id, title, stage, currency, source, raw_payload)
           VALUES ($1, $2, 'forged sibling', 'NEW', 'USD', 'manual', '{}'::jsonb)`,
          [tenantA, countryB],
        ),
        (err: unknown) => (err as { code?: string }).code === '42501',
      );

      // Descendant write is allowed from Country A because both membership and selected
      // context authorize Unit A.
      const descendantInsert = await c.query(
        `INSERT INTO platform.crm_leads (tenant_id, organization_id, title, stage, currency, source, raw_payload)
         VALUES ($1, $2, 'allowed descendant', 'NEW', 'USD', 'manual', '{}'::jsonb)
         RETURNING lead_id`,
        [tenantA, unitA],
      );
      assert.equal(descendantInsert.rowCount, 1);

      // Unscoped Lead rows fail closed.
      await assert.rejects(
        c.query(
          `INSERT INTO platform.crm_leads (tenant_id, organization_id, title, stage, currency, source, raw_payload)
           VALUES ($1, NULL, 'unscoped', 'NEW', 'USD', 'manual', '{}'::jsonb)`,
          [tenantA],
        ),
        (err: unknown) => (err as { code?: string }).code === '42501',
      );

      // Unit selection narrows visibility to itself.
      await setContext(c, { tenantId: tenantA, subjectId, organizationId: unitA });
      const seenFromUnit = await c.query(`SELECT organization_id FROM platform.crm_leads`);
      assert.ok(seenFromUnit.rows.length >= 1);
      assert.ok(seenFromUnit.rows.every((r) => r.organization_id === unitA), 'unit context must see only its own organization');

      // Same subject has no membership in tenant B, therefore no Lead is visible.
      await setContext(c, { tenantId: tenantB, subjectId, organizationId: otherTenantOrg });
      const seenOtherTenant = await c.query(`SELECT lead_id FROM platform.crm_leads`);
      assert.equal(seenOtherTenant.rowCount, 0, 'membership in tenant A must grant nothing in tenant B');
    } finally {
      c.release();
    }
  } finally {
    await suc.query(`DELETE FROM platform.crm_leads WHERE tenant_id = ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await suc.query(`DELETE FROM platform.memberships WHERE tenant_id = ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await suc.query(`DELETE FROM platform.organizations WHERE tenant_id = ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await suc.query(`DELETE FROM platform.tenants WHERE tenant_id = ANY($1::uuid[])`, [[tenantA, tenantB]]);
    suc.release();
    await su.end();
    if (app) await app.end();
  }
});
