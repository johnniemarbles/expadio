import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { startWorkflow, transitionWorkflow, recordCaseDecision, makerForStage, loadCaseWorkflowHistory, describeWorkflow } from '../lib/workflow-runtime';
import { assignParticipant } from '../lib/workflow-participants';

/**
 * DB-backed proof that the Decision Fabric is a universal engine, not a CRM
 * feature: a vendor — a non-CRM subject — runs through the same generic runtime
 * (blueprint resolution, participant gate, governed decision, append-only trace,
 * auto-completion) with no CRM-specific code in the path. vendor.onboarding v2
 * (0054) adds a decision-required APPROVAL stage; because the work type has no
 * registered authority deriver, that decision is gated by role + separation of
 * duties alone — the same authority gate as a CRM case, no monetary requirement.
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

async function seedTenant(c: pg.PoolClient): Promise<{ tenantId: string; roleId: string; s: (n: string) => string }> {
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

async function grantRole(c: pg.PoolClient, tenantId: string, roleId: string, subjectId: string): Promise<void> {
  await c.query(
    `INSERT INTO platform.authorization_assignments (tenant_id, subject_id, role_id, status) VALUES ($1, $2, $3, 'ACTIVE')`,
    [tenantId, subjectId, roleId],
  );
}

async function makeVendor(c: pg.PoolClient, tenantId: string): Promise<string> {
  return (await c.query(
    `INSERT INTO platform.vendors (tenant_id, legal_name, tax_id, blueprint_key)
     VALUES ($1, 'Globex Supplies', 'TAX-12345', 'vendor.onboarding') RETURNING vendor_id`,
    [tenantId],
  )).rows[0].vendor_id as string;
}

test('a vendor runs the Decision Fabric end to end through the generic runtime', async () => {
  await withClient(async (c) => {
    const { tenantId, roleId, s } = await seedTenant(c);
    await grantRole(c, tenantId, roleId, s('approver'));
    const vendorId = await makeVendor(c, tenantId);

    // Resolves the newest ACTIVE vendor.onboarding blueprint (v2) at SUBMITTED.
    const started = await startWorkflow(c, { tenantId, subjectType: 'vendor', subjectId: vendorId, blueprintKey: 'vendor.onboarding' });
    assert.ok(started.ok, 'vendor workflow should start');
    assert.equal(started.instance.workTypeKey, 'vendor.onboarding');
    assert.equal(started.instance.blueprint.scope, 'PLATFORM');
    assert.equal(started.instance.blueprint.version, 2);
    assert.equal(started.instance.currentStageKey, 'SUBMITTED');
    const instanceId = started.instance.instanceId;
    let rev = started.instance.revision;

    // The compliance gate: SCREENING requires a "screener" — blocked until one is assigned.
    const blocked = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: rev, toStageKey: 'SCREENING', requestedBySubjectId: s('submitter') });
    assert.ok(blocked.ok === false && blocked.reason === 'GATE_BLOCKED'
      && blocked.blockers.some((b) => b.code === 'WORKFLOW_PARTICIPANT_ASSIGNMENT_MISSING'));

    await assignParticipant(c, { tenantId, instanceId, stageKey: 'SCREENING', participantKey: 'screener', targetKind: 'USER', targetKey: s('carol'), assignedBySubjectId: s('submitter') });
    const toScreening = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: rev, toStageKey: 'SCREENING', requestedBySubjectId: s('submitter') });
    assert.ok(toScreening.ok && toScreening.instance.currentStageKey === 'SCREENING');
    rev = toScreening.instance.revision;

    // SCREENING → APPROVAL is ungated (APPROVAL requires no participant); carol moves it.
    const toApproval = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: rev, toStageKey: 'APPROVAL', requestedBySubjectId: s('carol') });
    assert.ok(toApproval.ok && toApproval.instance.currentStageKey === 'APPROVAL');
    rev = toApproval.instance.revision;

    // The decision gate: APPROVAL → ACTIVE is blocked until an APPROVE is recorded.
    const gated = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: rev, toStageKey: 'ACTIVE', requestedBySubjectId: s('carol') });
    assert.ok(gated.ok === false && gated.reason === 'GATE_BLOCKED', 'ACTIVE must be gated by the APPROVAL decision');

    // Separation of duties: the mover (carol) cannot approve their own vendor.
    const maker = await makerForStage(c, { tenantId, instanceId, stageKey: 'APPROVAL' });
    assert.equal(maker, s('carol'));
    const selfApprove = await recordCaseDecision(c, { tenantId, instanceId, workTypeKey: 'vendor.onboarding', stageKey: 'APPROVAL', outcome: 'APPROVE', approverSubjectId: s('carol'), makerSubjectId: maker });
    assert.ok(selfApprove.ok === false && selfApprove.reason === 'AUTHORITY_DENIED');

    // A different subject with a governing role approves — no monetary requirement applies.
    const approved = await recordCaseDecision(c, { tenantId, instanceId, workTypeKey: 'vendor.onboarding', stageKey: 'APPROVAL', outcome: 'APPROVE', approverSubjectId: s('approver'), makerSubjectId: maker });
    assert.ok(approved.ok, 'a governing, non-maker approver clears the gate');

    // With the decision recorded, reaching the final stage auto-completes the instance.
    const toActive = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: rev, toStageKey: 'ACTIVE', requestedBySubjectId: s('carol') });
    assert.ok(toActive.ok && toActive.instance.currentStageKey === 'ACTIVE' && toActive.instance.state === 'COMPLETED');

    // The trace is a chronological, append-only record of the transitions...
    const history = await loadCaseWorkflowHistory(c, { tenantId, instanceId });
    const transitions = history.filter((e) => e.kind === 'TRANSITION');
    assert.ok(transitions.length >= 3);
    for (let i = 1; i < history.length; i += 1) {
      assert.ok(history[i - 1].at <= history[i].at, 'history is chronological');
    }

    // ...and the transition log is immutable.
    await assert.rejects(
      c.query(`UPDATE platform.workflow_instance_transitions SET reason = 'tamper' WHERE instance_id = $1`, [instanceId]),
      /append-only/,
    );

    const described = await describeWorkflow(c, { tenantId, instanceId });
    assert.ok(described !== null && described.instance.state === 'COMPLETED');
  });
});
