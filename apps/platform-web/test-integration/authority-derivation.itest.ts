import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { startWorkflow } from '../lib/workflow-runtime.ts';
import { deriveAuthorityRequirements } from '../lib/workflow-authority-derivation.ts';

/**
 * The authority-derivation seam, exercised behaviourally. A CRM case derives a
 * monetary requirement from its account's agreements; a vendor (a work type with
 * no registered deriver) derives none. Dispatch is keyed by work type, not by
 * the subject's table — the generic decision path never special-cases a vertical.
 */

function pool(): pg.Pool {
  return new pg.Pool({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    database: process.env.PGDATABASE ?? 'expadio_test',
    max: 1,
  });
}

async function withClient(body: (c: pg.PoolClient) => Promise<void>): Promise<void> {
  const p = pool();
  const c = await p.connect();
  try {
    await body(c);
  } finally {
    c.release();
    await p.end();
  }
}

test('authority requirements dispatch by work type, not by subject table', async () => {
  await withClient(async (c) => {
    const tenantId = randomUUID();
    await c.query(`INSERT INTO platform.tenants (tenant_id, name) VALUES ($1, 'itest')`, [tenantId]);
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    const orgId = randomUUID();
    await c.query(`INSERT INTO platform.organizations (organization_id, tenant_id, name) VALUES ($1, $2, 'Org')`, [orgId, tenantId]);

    // A CRM case with a $50,000 ACTIVE agreement on its account.
    const accountId = (await c.query(
      `INSERT INTO platform.crm_accounts (tenant_id, name, lifecycle_stage, organization_id) VALUES ($1, 'Acme', 'CUSTOMER', $2) RETURNING account_id`,
      [tenantId, orgId],
    )).rows[0].account_id;
    await c.query(
      `INSERT INTO platform.crm_agreements (tenant_id, account_id, title, status, value_minor_units, currency) VALUES ($1, $2, 'Deal', 'ACTIVE', 5000000, 'USD')`,
      [tenantId, accountId],
    );
    const caseId = (await c.query(
      `INSERT INTO platform.crm_cases (tenant_id, account_id, subject, blueprint_key) VALUES ($1, $2, 'Case', 'crm.case') RETURNING case_id`,
      [tenantId, accountId],
    )).rows[0].case_id;
    const caseStart = await startWorkflow(c, { tenantId, subjectType: 'crm.case', subjectId: caseId, blueprintKey: 'crm.case' });
    assert.ok(caseStart.ok);
    const caseInstance = caseStart.instance.instanceId;

    // A vendor bound to the vendor.onboarding blueprint (no registered deriver).
    const vendorId = (await c.query(
      `INSERT INTO platform.vendors (tenant_id, legal_name, blueprint_key) VALUES ($1, 'Globex', 'vendor.onboarding') RETURNING vendor_id`,
      [tenantId],
    )).rows[0].vendor_id;
    const vendorStart = await startWorkflow(c, { tenantId, subjectType: 'vendor', subjectId: vendorId, blueprintKey: 'vendor.onboarding' });
    assert.ok(vendorStart.ok);
    const vendorInstance = vendorStart.instance.instanceId;

    // crm.case → the monetary requirement, scoped to the account's organization.
    const caseReq = await deriveAuthorityRequirements(c, { tenantId, instanceId: caseInstance, workTypeKey: 'crm.case' });
    assert.equal(caseReq.length, 1);
    assert.equal(caseReq[0].dimensionKey, 'monetary.approval');
    assert.equal(caseReq[0].requiredValue, 5000000);
    assert.equal(caseReq[0].scopeType, 'ORGANIZATION');
    assert.equal(caseReq[0].scopeEntityId, orgId);

    // vendor.onboarding → no requirement (role + SoD alone would gate it).
    const vendorReq = await deriveAuthorityRequirements(c, { tenantId, instanceId: vendorInstance, workTypeKey: 'vendor.onboarding' });
    assert.deepEqual(vendorReq, []);

    // Dispatch is by work type: asking for the case instance under the vendor
    // work type derives nothing — the CRM query is never reached.
    const misdirected = await deriveAuthorityRequirements(c, { tenantId, instanceId: caseInstance, workTypeKey: 'vendor.onboarding' });
    assert.deepEqual(misdirected, []);
  });
});
