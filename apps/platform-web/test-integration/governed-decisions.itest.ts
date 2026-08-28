import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { startWorkflow, transitionWorkflow, recordCaseDecision, makerForStage } from '../lib/workflow-runtime.ts';
import { assignParticipant } from '../lib/workflow-participants.ts';
import { grantAuthority } from '../lib/workflow-authority-grants.ts';
import { loadTenantDecisions } from '../lib/governance-decisions.ts';

/**
 * The tenant-wide decision log reads across verticals: after an expense and a
 * vendor each record a decision, both appear in one query, newest first, and the
 * work-type filter narrows to one process — all under the tenant's RLS context.
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

test('the governed-decision log aggregates decisions across verticals', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const ns = tenantId.slice(0, 8);
    const s = (n: string) => `${ns}-${n}`;
    await c.query(`INSERT INTO platform.tenants (tenant_id, name) VALUES ($1, 'itest')`, [tenantId]);
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    const roleId = (await c.query(
      `INSERT INTO platform.authorization_roles (role_key, display_name, ownership_scope, tenant_id) VALUES ('TENANT_ADMIN','Admin','TENANT',$1) RETURNING role_id`,
      [tenantId],
    )).rows[0].role_id as string;
    await c.query(`INSERT INTO platform.authorization_assignments (tenant_id, subject_id, role_id, status) VALUES ($1,$2,$3,'ACTIVE')`, [tenantId, s('approver'), roleId]);
    await grantAuthority(c, { tenantId, subjectId: s('approver'), dimensionKey: 'monetary.approval', thresholdMinorUnits: 10_000_000, currency: 'USD', scopeType: 'TENANT', scopeEntityId: null, delegatedFromSubjectId: null, grantedBySubjectId: s('admin') });

    // Vendor: drive to APPROVAL and approve (role + SoD only).
    const vendorId = (await c.query(`INSERT INTO platform.vendors (tenant_id, legal_name, blueprint_key) VALUES ($1,'Globex','vendor.onboarding') RETURNING vendor_id`, [tenantId])).rows[0].vendor_id;
    const vs = await startWorkflow(c, { tenantId, subjectType: 'vendor', subjectId: vendorId, blueprintKey: 'vendor.onboarding' });
    assert.ok(vs.ok); let vr = vs.instance.revision; const vi = vs.instance.instanceId;
    await assignParticipant(c, { tenantId, instanceId: vi, stageKey: 'SCREENING', participantKey: 'screener', targetKind: 'USER', targetKey: s('carol'), assignedBySubjectId: s('maker') });
    vr = (await transitionWorkflow(c, { tenantId, instanceId: vi, expectedRevision: vr, toStageKey: 'SCREENING', requestedBySubjectId: s('maker') }) as { instance: { revision: number } }).instance.revision;
    await transitionWorkflow(c, { tenantId, instanceId: vi, expectedRevision: vr, toStageKey: 'APPROVAL', requestedBySubjectId: s('maker') });
    const vmaker = await makerForStage(c, { tenantId, instanceId: vi, stageKey: 'APPROVAL' });
    assert.ok((await recordCaseDecision(c, { tenantId, instanceId: vi, workTypeKey: 'vendor.onboarding', stageKey: 'APPROVAL', outcome: 'APPROVE', approverSubjectId: s('approver'), makerSubjectId: vmaker })).ok);

    // Expense: drive to MANAGER_REVIEW and approve (monetary threshold from amount).
    const expId = (await c.query(`INSERT INTO platform.expense_reports (tenant_id, purpose, amount_minor_units, blueprint_key) VALUES ($1,'Travel',500000,'expense.reimbursement') RETURNING expense_id`, [tenantId])).rows[0].expense_id;
    const es = await startWorkflow(c, { tenantId, subjectType: 'expense.reimbursement', subjectId: expId, blueprintKey: 'expense.reimbursement' });
    assert.ok(es.ok); let er = es.instance.revision; const ei = es.instance.instanceId;
    await assignParticipant(c, { tenantId, instanceId: ei, stageKey: 'MANAGER_REVIEW', participantKey: 'manager', targetKind: 'USER', targetKey: s('approver'), assignedBySubjectId: s('maker') });
    await transitionWorkflow(c, { tenantId, instanceId: ei, expectedRevision: er, toStageKey: 'MANAGER_REVIEW', requestedBySubjectId: s('maker') });
    const emaker = await makerForStage(c, { tenantId, instanceId: ei, stageKey: 'MANAGER_REVIEW' });
    assert.ok((await recordCaseDecision(c, { tenantId, instanceId: ei, workTypeKey: 'expense.reimbursement', stageKey: 'MANAGER_REVIEW', outcome: 'APPROVE', approverSubjectId: s('approver'), makerSubjectId: emaker })).ok);

    // Both decisions appear in the tenant-wide log, newest first.
    const all = await loadTenantDecisions(c, {});
    const workTypes = all.map((d) => d.workTypeKey);
    assert.ok(workTypes.includes('vendor.onboarding') && workTypes.includes('expense.reimbursement'));
    for (let i = 1; i < all.length; i += 1) assert.ok(all[i - 1].decidedAt >= all[i].decidedAt, 'newest first');
    assert.ok(all.every((d) => d.evidenceRefs.length > 0), 'each decision carries authority/SoD evidence');

    // The work-type filter narrows to one process.
    const onlyExpense = await loadTenantDecisions(c, { workTypeKey: 'expense.reimbursement' });
    assert.ok(onlyExpense.length >= 1 && onlyExpense.every((d) => d.workTypeKey === 'expense.reimbursement'));
  } finally {
    c.release();
    await p.end();
  }
});
