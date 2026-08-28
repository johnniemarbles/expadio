import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { startWorkflow } from '../lib/workflow-runtime.ts';
import { loadTenantInstances } from '../lib/governance-instances.ts';

/**
 * The in-flight workflow view returns open instances across verticals and drops
 * completed ones, RLS-scoped, filterable by work type.
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

test('the in-flight view shows open instances and omits completed ones', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    await c.query(`INSERT INTO platform.tenants (tenant_id, name) VALUES ($1, 'itest')`, [tenantId]);
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    // An open vendor instance (parked at SUBMITTED).
    const vendorId = (await c.query(`INSERT INTO platform.vendors (tenant_id, legal_name, blueprint_key) VALUES ($1,'Globex','vendor.onboarding') RETURNING vendor_id`, [tenantId])).rows[0].vendor_id;
    const vs = await startWorkflow(c, { tenantId, subjectType: 'vendor', subjectId: vendorId, blueprintKey: 'vendor.onboarding' });
    assert.ok(vs.ok);

    // A vendor that is driven to completion (v1 path via an older instance is not
    // available; instead start a second vendor and force it: assign screener,
    // SCREENING -> APPROVAL requires a decision, so it stays open — good enough:
    // we assert the open one shows and a manufactured COMPLETED one does not).
    const openInstances = await loadTenantInstances(c, {});
    assert.ok(openInstances.some((i) => i.workTypeKey === 'vendor.onboarding' && i.state === 'RUNNING'),
      'the running vendor instance is in the open view');

    // Directly mark a throwaway instance COMPLETED and confirm it is excluded.
    const doneVendor = (await c.query(`INSERT INTO platform.vendors (tenant_id, legal_name, blueprint_key) VALUES ($1,'DoneCo','vendor.onboarding') RETURNING vendor_id`, [tenantId])).rows[0].vendor_id;
    const ds = await startWorkflow(c, { tenantId, subjectType: 'vendor', subjectId: doneVendor, blueprintKey: 'vendor.onboarding' });
    assert.ok(ds.ok);
    await c.query(`UPDATE platform.workflow_instances SET state='COMPLETED', completed_at=now() WHERE instance_id=$1`, [ds.instance.instanceId]);

    const openAfter = await loadTenantInstances(c, {});
    assert.ok(!openAfter.some((i) => i.subjectId === doneVendor), 'a completed instance is omitted from the open view');

    // The work-type filter narrows to one process.
    const onlyVendor = await loadTenantInstances(c, { workTypeKey: 'vendor.onboarding' });
    assert.ok(onlyVendor.length >= 1 && onlyVendor.every((i) => i.workTypeKey === 'vendor.onboarding'));

    // An explicit state filter can surface completed instances too.
    const completed = await loadTenantInstances(c, { state: 'COMPLETED' });
    assert.ok(completed.some((i) => i.subjectId === doneVendor), 'an explicit COMPLETED filter surfaces the completed instance');
  } finally {
    c.release();
    await p.end();
  }
});
