import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { startWorkflow, transitionWorkflow, recordCaseDecision, makerForStage } from '../lib/workflow-runtime';
import { assignParticipant } from '../lib/workflow-participants';
import { grantAuthority } from '../lib/workflow-authority-grants';

/**
 * Third vertical, engine-level proof: expense reimbursement runs the same
 * generic runtime as CRM cases and vendors, but derives its approval authority a
 * third way — from the expense's OWN amount. MANAGER_REVIEW is one stage that
 * exercises both gates: a required "manager" participant blocks entry, and a
 * decision that must clear a monetary threshold equal to the amount blocks exit.
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

async function seed(c: pg.PoolClient): Promise<{ tenantId: string; roleId: string; s: (n: string) => string }> {
  const tenantId = randomUUID();
  const ns = tenantId.slice(0, 8);
  await c.query(`INSERT INTO platform.tenants (tenant_id, name) VALUES ($1, 'itest')`, [tenantId]);
  await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
  const roleId = (await c.query(
    `INSERT INTO platform.authorization_roles (role_key, display_name, ownership_scope, tenant_id)
     VALUES ('TENANT_ADMIN', 'Admin', 'TENANT', $1) RETURNING role_id`,
    [tenantId],
  )).rows[0].role_id as string;
  return { tenantId, roleId, s: (n) => `${ns}-${n}` };
}

const grantRole = (c: pg.PoolClient, tenantId: string, roleId: string, subjectId: string) =>
  c.query(`INSERT INTO platform.authorization_assignments (tenant_id, subject_id, role_id, status) VALUES ($1, $2, $3, 'ACTIVE')`, [tenantId, subjectId, roleId]);

async function makeExpense(c: pg.PoolClient, tenantId: string, amount: number): Promise<string> {
  return (await c.query(
    `INSERT INTO platform.expense_reports (tenant_id, purpose, amount_minor_units, currency, blueprint_key)
     VALUES ($1, 'Conference travel', $2, 'USD', 'expense.reimbursement') RETURNING expense_id`,
    [tenantId, amount],
  )).rows[0].expense_id as string;
}

test('an expense runs the engine and its approval clears a threshold from its own amount', async () => {
  await withClient(async (c) => {
    const { tenantId, roleId, s } = await seed(c);
    const AMOUNT = 500_000; // $5,000.00

    // Two governing approvers: one under the amount ceiling, one over it.
    for (const name of ['under', 'over']) {
      await grantRole(c, tenantId, roleId, s(name));
    }
    await grantAuthority(c, { tenantId, subjectId: s('under'), dimensionKey: 'monetary.approval', thresholdMinorUnits: 100_000, currency: 'USD', scopeType: 'TENANT', scopeEntityId: null, delegatedFromSubjectId: null, grantedBySubjectId: s('admin') });
    await grantAuthority(c, { tenantId, subjectId: s('over'), dimensionKey: 'monetary.approval', thresholdMinorUnits: 1_000_000, currency: 'USD', scopeType: 'TENANT', scopeEntityId: null, delegatedFromSubjectId: null, grantedBySubjectId: s('admin') });

    const expenseId = await makeExpense(c, tenantId, AMOUNT);
    const started = await startWorkflow(c, { tenantId, subjectType: 'expense.reimbursement', subjectId: expenseId, blueprintKey: 'expense.reimbursement' });
    assert.ok(started.ok && started.instance.currentStageKey === 'SUBMITTED');
    const instanceId = started.instance.instanceId;
    let rev = started.instance.revision;

    // Participant gate: entering MANAGER_REVIEW needs a "manager".
    const blocked = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: rev, toStageKey: 'MANAGER_REVIEW', requestedBySubjectId: s('employee') });
    assert.ok(blocked.ok === false && blocked.reason === 'GATE_BLOCKED'
      && blocked.blockers.some((b) => b.code === 'WORKFLOW_PARTICIPANT_ASSIGNMENT_MISSING'));

    await assignParticipant(c, { tenantId, instanceId, stageKey: 'MANAGER_REVIEW', participantKey: 'manager', targetKind: 'USER', targetKey: s('over'), assignedBySubjectId: s('employee') });
    const toReview = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: rev, toStageKey: 'MANAGER_REVIEW', requestedBySubjectId: s('employee') });
    assert.ok(toReview.ok && toReview.instance.currentStageKey === 'MANAGER_REVIEW');
    rev = toReview.instance.revision;

    // Decision gate: PAID is blocked until an APPROVE is recorded.
    const gated = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: rev, toStageKey: 'PAID', requestedBySubjectId: s('over') });
    assert.ok(gated.ok === false && gated.reason === 'GATE_BLOCKED');

    const maker = await makerForStage(c, { tenantId, instanceId, stageKey: 'MANAGER_REVIEW' });
    assert.equal(maker, s('employee'));

    // The $1,000 approver cannot clear a $5,000 expense — threshold denied.
    const under = await recordCaseDecision(c, { tenantId, instanceId, workTypeKey: 'expense.reimbursement', stageKey: 'MANAGER_REVIEW', outcome: 'APPROVE', approverSubjectId: s('under'), makerSubjectId: maker });
    assert.ok(under.ok === false && under.reason === 'AUTHORITY_DENIED' && under.code === 'WORKFLOW_AUTHORITY_THRESHOLD',
      'the requirement must come from the expense amount, not a CRM agreement');

    // The $10,000 approver clears it.
    const over = await recordCaseDecision(c, { tenantId, instanceId, workTypeKey: 'expense.reimbursement', stageKey: 'MANAGER_REVIEW', outcome: 'APPROVE', approverSubjectId: s('over'), makerSubjectId: maker });
    assert.ok(over.ok, 'an approver whose ceiling covers the amount clears the gate');

    // With the decision recorded, PAID auto-completes the instance.
    const paid = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: rev, toStageKey: 'PAID', requestedBySubjectId: s('employee') });
    assert.ok(paid.ok && paid.instance.currentStageKey === 'PAID' && paid.instance.state === 'COMPLETED');
  });
});
