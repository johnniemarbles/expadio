const { Pool } = require('pg');

if (!process.env.DATABASE_URL) { console.error("FATAL ERROR: DATABASE_URL is not set in environment variables! Railway cannot connect to PostgreSQL."); process.exit(1); }
const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';
const DEFAULT_ORG = '00000000-0000-0000-0000-000000000002';
const SUBJECT_ID = process.env.CLERK_ADMIN_USER_ID || process.argv[2];

if (!SUBJECT_ID) {
  console.log("No CLERK_ADMIN_USER_ID provided. Skipping membership database seeding.");
  process.exit(0);
}

async function seed() {
  console.log("Seeding database for subject:", SUBJECT_ID);
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ensure Tenant exists
    const resTenant = await client.query('SELECT tenant_id FROM platform.tenants WHERE tenant_id = $1', [DEFAULT_TENANT]);
    if (resTenant.rowCount === 0) {
      await client.query(
        "INSERT INTO platform.tenants (tenant_id, name, status) VALUES ($1, 'Dreamware Inc', 'ACTIVE')",
        [DEFAULT_TENANT]
      );
      console.log(`Created tenant: ${DEFAULT_TENANT}`);
    }

    // 2. Ensure Org exists
    const resOrg = await client.query('SELECT organization_id FROM platform.organizations WHERE organization_id = $1', [DEFAULT_ORG]);
    if (resOrg.rowCount === 0) {
      await client.query(
        "INSERT INTO platform.organizations (organization_id, tenant_id, organization_kind, name, status) VALUES ($1, $2, 'BUSINESS', 'Dreamware Platform', 'ACTIVE')",
        [DEFAULT_ORG, DEFAULT_TENANT]
      );
      console.log(`Created organization: ${DEFAULT_ORG}`);
    }

    // 3. Insert subject membership
    const resMember = await client.query('SELECT membership_id FROM platform.memberships WHERE subject_id = $1 AND tenant_id = $2', [SUBJECT_ID, DEFAULT_TENANT]);
    if (resMember.rowCount === 0) {
      await client.query(
        `INSERT INTO platform.memberships (tenant_id, organization_id, subject_id, actor_kind, status, issuer, workspace_scope_mode, operating_unit_scope_mode)
         VALUES ($1, $2, $3, 'user', 'ACTIVE', 'https://clerk.expadio.com', 'ALL', 'ALL')`,
        [DEFAULT_TENANT, DEFAULT_ORG, SUBJECT_ID]
      );
      console.log(`Granted membership to subject: ${SUBJECT_ID}`);
    } else {
      await client.query("UPDATE platform.memberships SET issuer = 'https://clerk.expadio.com' WHERE subject_id = $1", [SUBJECT_ID]);
      console.log(`Subject ${SUBJECT_ID} already has membership. Updated issuer.`);
    }

    await client.query('COMMIT');
    console.log("Database seeded successfully.");

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Error seeding database:", err);
    process.exit(1);
  } finally {
    client.release();
    await dbPool.end();
  }
}

seed();
