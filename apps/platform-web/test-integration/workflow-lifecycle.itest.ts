import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  startWorkflow,
  transitionWorkflow,
  recordCaseDecision,
  makerForStage,
  loadCaseWorkflowHistory,
  describeWorkflow,
} from '../lib/workflow-runtime';
import { assignParticipant } from '../lib/workflow-participants';
import { grantAuthority } from '../lib/workflow-authority-grants';

/**
 * DB-backed integration harness for the Decision Fabric case runtime.
 *
 * Unlike the strip-types contract tests (which check source shape) this exercises
 * the real runtime + Postgres adapters against a live database, asserting DB
 * state through every gate. It is what would have caught the two latent bugs
 * found by hand this cycle (ambiguous `revision` in commitTransition; a uuid/text
 * case mismatch in org-scope).
 *
 * Each test allocates a fresh tenant and namespaces every subject id with that
 * tenant, so tests are fully isolated and repeatable even against an
 * already-populated database and regardless of whether the connecting role
 * enforces RLS.
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

interface Seed {
  readonly tenantId: string;
  readonly orgId: string;
  readonly roleId: string;
  /** Namespaces a subject id to this tenant so it never collides across tenants. */
  readonly s: (name: string) => string;
}

async function seedTenant(c: pg.PoolClient): Promise<Seed> {
  const tenantId = randomUUID();
  const orgId = randomUUID();
  const ns = tenantId.slice(0, 8);
  await c.query(`INSERT INTO platform.tenants (tenant_id, name) VALUES ($1, 'itest')`, [tenantId]);
  await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
  await c.query(`INSERT INTO platform.organizations (organization_id, tenant_id, name) VALUES ($1, $2, 'Org')`, [orgId, tenantId]);
  const roleId = (await c.query(
    `INSERT INTO platform.authorization_roles (role_key, display_name, ownership_scope, tenant_id)
     VALUES ('TENANT_ADMIN', 'Admin', 'TENANT', $1) RETURNING role_id`,
    [tenantId],
  )).rows[0].role_id as string;
  return { tenantId, orgId, roleId, s: (name) => `${ns}-${name}` };
}

async function grantRole(c: pg.PoolClient, tenantId: string, roleId: string, subjectId: string): Promise<void> {
  await c.query(
    `INSERT INTO platform.authorization_assignments (tenant_id, subject_id, role_id, status) VALUES ($1, $2, $3, 'ACTIVE')`,
    [tenantId, subjectId, roleId],
  );
}

async function makeCase(c: pg.PoolClient, tenantId: string, opts: { orgId?: string; agreementMinor?: number } = {}): Promise<{ caseId: string; accountId: string | null }> {
  let accountId: string | null = null;
  if (opts.orgId !== undefined) {
    accountId = (await c.query(
      `INSERT INTO platform.crm_accounts (tenant_id, name, lifecycle_stage, organization_id) VALUES ($1, 'Acme', 'CUSTOMER', $2) RETURNING account_id`,
      [tenantId, opts.orgId],
    )).rows[0].account_id;
    if (opts.agreementMinor !== undefined) {
      await c.query(
        `INSERT INTO platform.crm_agreements (tenant_id, account_id, title, status, value_minor_units, currency) VALUES ($1, $2, 'Deal', 'ACTIVE', $3, 'USD')`,
        [tenantId, accountId, opts.agreementMinor],
      );
    }
  }
  const caseId = (await c.query(
    `INSERT INTO platform.crm_cases (tenant_id, account_id, subject, blueprint_key) VALUES ($1, $2, 'Case', 'crm.case') RETURNING case_id`,
    [tenantId, accountId],
  )).rows[0].case_id;
  return { caseId, accountId };
}

/** Drive a case to REVIEW with a reviewer assigned; returns { instanceId, revision }. */
async function toReview(c: pg.PoolClient, tenantId: string, caseId: string, mover: string): Promise<{ instanceId: string; revision: number }> {
  const started = await startWorkflow(c, { tenantId, subjectType: 'crm.case', subjectId: caseId, blueprintKey: 'crm.case' });
  assert.ok(started.ok, 'workflow should start');
  const instanceId = started.instance.instanceId;
  await assignParticipant(c, { tenantId, instanceId, stageKey: 'REVIEW', participantKey: 'reviewer', targetKind: 'USER', targetKey: mover, assignedBySubjectId: mover });
  let rev = started.instance.revision;
  const t1 = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: rev, toStageKey: 'IN_PROGRESS', requestedBySubjectId: mover });
  assert.ok(t1.ok); rev = t1.instance.revision;
  const t2 = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: rev, toStageKey: 'REVIEW', requestedBySubjectId: mover });
  assert.ok(t2.ok); rev = t2.instance.revision;
  return { instanceId, revision: rev };
}

const dec = (c: pg.PoolClient, tenantId: string, instanceId: string, approver: string, maker: string | null) =>
  recordCaseDecision(c, { tenantId, instanceId, workTypeKey: 'crm.case', stageKey: 'REVIEW', outcome: 'APPROVE', approverSubjectId: approver, makerSubjectId: maker });

test('participant gate blocks entering REVIEW until a reviewer is assigned', async () => {
  await withClient(async (c) => {
    const { tenantId, s } = await seedTenant(c);
    const { caseId } = await makeCase(c, tenantId);
    const started = await startWorkflow(c, { tenantId, subjectType: 'crm.case', subjectId: caseId, blueprintKey: 'crm.case' });
    assert.ok(started.ok);
    const instanceId = started.instance.instanceId;
    let rev = started.instance.revision;
    const t1 = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: rev, toStageKey: 'IN_PROGRESS', requestedBySubjectId: s('alice') });
    assert.ok(t1.ok); rev = t1.instance.revision;
    const blocked = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: rev, toStageKey: 'REVIEW', requestedBySubjectId: s('alice') });
    assert.ok(blocked.ok === false && blocked.reason === 'GATE_BLOCKED' && blocked.blockers.some((b) => b.code === 'WORKFLOW_PARTICIPANT_ASSIGNMENT_MISSING'));
    await assignParticipant(c, { tenantId, instanceId, stageKey: 'REVIEW', participantKey: 'reviewer', targetKind: 'USER', targetKey: s('bob'), assignedBySubjectId: s('alice') });
    const ok = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: rev, toStageKey: 'REVIEW', requestedBySubjectId: s('alice') });
    assert.ok(ok.ok && ok.instance.currentStageKey === 'REVIEW');
  });
});

test('decision requires a governing role, four-eyes, and passes evidence', async () => {
  await withClient(async (c) => {
    const { tenantId, roleId, s } = await seedTenant(c);
    await grantRole(c, tenantId, roleId, s('approver'));
    const { caseId } = await makeCase(c, tenantId);
    const { instanceId } = await toReview(c, tenantId, caseId, s('mover'));
    const maker = await makerForStage(c, { tenantId, instanceId, stageKey: 'REVIEW' });
    assert.equal(maker, s('mover'));

    // No governing role → denied.
    const noRole = await dec(c, tenantId, instanceId, s('nobody'), maker);
    assert.ok(noRole.ok === false && noRole.reason === 'AUTHORITY_DENIED' && noRole.code === 'WORKFLOW_AUTHORITY_ROLE_MISSING');

    // Self-approval (approver === maker) → denied, even with a role.
    await grantRole(c, tenantId, roleId, s('mover'));
    const selfApprove = await dec(c, tenantId, instanceId, s('mover'), maker);
    assert.ok(selfApprove.ok === false && selfApprove.reason === 'AUTHORITY_DENIED' && selfApprove.code === 'WORKFLOW_SOD_SELF_APPROVAL');

    // Valid approver → committed, with role + SoD evidence.
    const ok = await dec(c, tenantId, instanceId, s('approver'), maker);
    assert.ok(ok.ok);
    const evidence = (await c.query(
      `SELECT evidence_refs FROM platform.workflow_stage_decisions WHERE instance_id = $1 AND stage_key = 'REVIEW'`,
      [instanceId],
    )).rows[0].evidence_refs as string[];
    assert.ok(evidence.includes('authority:role:TENANT_ADMIN'));
    assert.ok(evidence.includes(`sod:maker:${s('mover')}`));
    assert.ok(evidence.includes(`sod:checker:${s('approver')}`));

    // Only one immutable decision on the stage.
    await dec(c, tenantId, instanceId, s('approver'), maker);
    const count = (await c.query(`SELECT count(*)::int n FROM platform.workflow_stage_decisions WHERE instance_id = $1 AND stage_key = 'REVIEW'`, [instanceId])).rows[0].n;
    assert.equal(count, 1);
  });
});

test('monetary/org-scope/delegation authority is enforced at decision', async () => {
  await withClient(async (c) => {
    const { tenantId, orgId, roleId, s } = await seedTenant(c);
    const otherOrg = randomUUID();
    await c.query(`INSERT INTO platform.organizations (organization_id, tenant_id, name) VALUES ($1, $2, 'Other')`, [otherOrg, tenantId]);
    for (const name of ['bob', 'dave', 'eve', 'mover']) await grantRole(c, tenantId, roleId, s(name));
    const grant = (name: string, amt: number, scopeType: 'TENANT' | 'ORGANIZATION', scopeEntityId: string | null, delegatedFrom: string | null) =>
      grantAuthority(c, { tenantId, subjectId: s(name), dimensionKey: 'monetary.approval', thresholdMinorUnits: amt, currency: 'USD', scopeType, scopeEntityId, delegatedFromSubjectId: delegatedFrom, grantedBySubjectId: s('admin') });

    // Threshold: 1,000,000 required (from the case's ACTIVE agreement).
    const a = await makeCase(c, tenantId, { orgId, agreementMinor: 1_000_000 });
    const r1 = await toReview(c, tenantId, a.caseId, s('mover'));
    await grant('bob', 500_000, 'TENANT', null, null);
    const under = await dec(c, tenantId, r1.instanceId, s('bob'), s('mover'));
    assert.ok(under.ok === false && under.reason === 'AUTHORITY_DENIED' && under.code === 'WORKFLOW_AUTHORITY_THRESHOLD');
    await grant('bob', 1_000_000, 'TENANT', null, null);
    const meets = await dec(c, tenantId, r1.instanceId, s('bob'), s('mover'));
    assert.ok(meets.ok);

    // Delegation: dave carries a delegated grant from bob.
    const b = await makeCase(c, tenantId, { orgId, agreementMinor: 1_000_000 });
    const r2 = await toReview(c, tenantId, b.caseId, s('mover'));
    await grant('dave', 1_000_000, 'TENANT', null, s('bob'));
    const deleg = await dec(c, tenantId, r2.instanceId, s('dave'), s('mover'));
    assert.ok(deleg.ok);
    const evd = (await c.query(`SELECT evidence_refs FROM platform.workflow_stage_decisions WHERE instance_id = $1`, [r2.instanceId])).rows[0].evidence_refs as string[];
    assert.ok(evd.includes(`authority:delegation:${s('bob')}`));

    // Org scope: a grant scoped to a different org does not satisfy; the right org does.
    const d = await makeCase(c, tenantId, { orgId, agreementMinor: 1_000_000 });
    const r3 = await toReview(c, tenantId, d.caseId, s('mover'));
    await grant('eve', 1_000_000, 'ORGANIZATION', otherOrg, null);
    const wrongOrg = await dec(c, tenantId, r3.instanceId, s('eve'), s('mover'));
    assert.ok(wrongOrg.ok === false && wrongOrg.reason === 'AUTHORITY_DENIED' && wrongOrg.code === 'WORKFLOW_AUTHORITY_THRESHOLD');
    await grant('eve', 1_000_000, 'ORGANIZATION', orgId, null);
    const rightOrg = await dec(c, tenantId, r3.instanceId, s('eve'), s('mover'));
    assert.ok(rightOrg.ok);
  });
});

test('entry condition blocks RESOLVED without an account, then auto-completes', async () => {
  await withClient(async (c) => {
    const { tenantId, orgId, roleId, s } = await seedTenant(c);
    await grantRole(c, tenantId, roleId, s('approver'));
    // Case with no account: no monetary requirement, but the RESOLVED entry
    // condition (case.has_account) must block until an account is linked.
    const { caseId } = await makeCase(c, tenantId);
    const { instanceId, revision } = await toReview(c, tenantId, caseId, s('mover'));
    const ok = await dec(c, tenantId, instanceId, s('approver'), s('mover'));
    assert.ok(ok.ok);

    const blocked = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: revision, toStageKey: 'RESOLVED', requestedBySubjectId: s('approver') });
    assert.ok(blocked.ok === false && blocked.reason === 'GATE_BLOCKED' && blocked.blockers.some((b) => b.code === 'CASE_ACCOUNT_MISSING'));

    // Link an account, then RESOLVED succeeds and the instance auto-completes.
    const accountId = (await c.query(`INSERT INTO platform.crm_accounts (tenant_id, name, lifecycle_stage, organization_id) VALUES ($1, 'Acme', 'CUSTOMER', $2) RETURNING account_id`, [tenantId, orgId])).rows[0].account_id;
    await c.query(`UPDATE platform.crm_cases SET account_id = $2 WHERE case_id = $1`, [caseId, accountId]);
    const resolved = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: revision, toStageKey: 'RESOLVED', requestedBySubjectId: s('approver') });
    assert.ok(resolved.ok && resolved.instance.state === 'COMPLETED' && resolved.instance.currentStageKey === 'RESOLVED');

    const row = (await c.query(`SELECT state, completed_at IS NOT NULL AS done FROM platform.workflow_instances WHERE instance_id = $1`, [instanceId])).rows[0];
    assert.equal(row.state, 'COMPLETED');
    assert.equal(row.done, true);
  });
});

test('transitions and decisions are append-only/immutable, and the trace is ordered', async () => {
  await withClient(async (c) => {
    const { tenantId, orgId, roleId, s } = await seedTenant(c);
    await grantRole(c, tenantId, roleId, s('approver'));
    const { caseId } = await makeCase(c, tenantId, { orgId });
    const { instanceId, revision } = await toReview(c, tenantId, caseId, s('mover'));
    await dec(c, tenantId, instanceId, s('approver'), s('mover'));
    const resolved = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: revision, toStageKey: 'RESOLVED', requestedBySubjectId: s('approver') });
    assert.ok(resolved.ok);

    // Trace is chronological with the decision before the transition it unlocked.
    const history = await loadCaseWorkflowHistory(c, { tenantId, instanceId });
    const kinds = history.map((e) => e.kind);
    assert.ok(kinds.includes('DECISION'));
    assert.ok(kinds.filter((k) => k === 'TRANSITION').length >= 3);
    for (let i = 1; i < history.length; i += 1) {
      assert.ok(history[i - 1].at <= history[i].at, 'history is chronological');
    }

    // Append-only trigger rejects mutation of a transition; immutable trigger a decision.
    await assert.rejects(
      c.query(`UPDATE platform.workflow_instance_transitions SET reason = 'tamper' WHERE instance_id = $1`, [instanceId]),
      /append-only/,
    );
    await assert.rejects(
      c.query(`UPDATE platform.workflow_stage_decisions SET outcome = 'RETURN' WHERE instance_id = $1`, [instanceId]),
      /immutable/,
    );

    const described = await describeWorkflow(c, { tenantId, instanceId });
    assert.ok(described !== null && described.instance.state === 'COMPLETED');
  });
});
