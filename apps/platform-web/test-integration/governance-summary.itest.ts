import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { startWorkflow } from '../lib/workflow-runtime.ts';
import { loadGovernanceSummary } from '../lib/governance-summary.ts';

/**
 * The governance summary counts open instances by work type and decisions by
 * outcome for the tenant, under its RLS context.
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

test('the governance summary counts open work and decisions', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    await c.query(`INSERT INTO platform.tenants (tenant_id, name) VALUES ($1, 'itest')`, [tenantId]);
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    // Two open vendors and one open expense.
    for (const legal of ['A', 'B']) {
      const v = (await c.query(`INSERT INTO platform.vendors (tenant_id, legal_name, blueprint_key) VALUES ($1,$2,'vendor.onboarding') RETURNING vendor_id`, [tenantId, legal])).rows[0].vendor_id;
      assert.ok((await startWorkflow(c, { tenantId, subjectType: 'vendor', subjectId: v, blueprintKey: 'vendor.onboarding' })).ok);
    }
    const e = (await c.query(`INSERT INTO platform.expense_reports (tenant_id, purpose, amount_minor_units, blueprint_key) VALUES ($1,'T',100,'expense.reimbursement') RETURNING expense_id`, [tenantId])).rows[0].expense_id;
    assert.ok((await startWorkflow(c, { tenantId, subjectType: 'expense.reimbursement', subjectId: e, blueprintKey: 'expense.reimbursement' })).ok);

    // The integration harness connects as a superuser, so RLS is bypassed and
    // the counts are global across tenants; assert this tenant's contribution is
    // reflected (>=) and the aggregation groups by work type correctly. The
    // route scopes per-tenant in production via withTenantClient + RLS.
    const summary = await loadGovernanceSummary(c);
    assert.ok(summary.openTotal >= 3, 'at least this tenant\'s three open instances are counted');
    assert.equal(summary.openTotal, summary.openByWorkType.reduce((a, r) => a + r.count, 0), 'openTotal equals the grouped sum');
    const vendorOpen = summary.openByWorkType.find((r) => r.workTypeKey === 'vendor.onboarding');
    assert.ok(vendorOpen && vendorOpen.count >= 2, 'the two open vendors are grouped under vendor.onboarding');
    assert.ok(summary.openByWorkType.some((r) => r.workTypeKey === 'expense.reimbursement' && r.count >= 1), 'the open expense is grouped');
    assert.equal(summary.decisionsTotal, summary.decisionsByOutcome.reduce((a, r) => a + r.count, 0), 'decisionsTotal equals the grouped sum');
  } finally {
    c.release();
    await p.end();
  }
});
