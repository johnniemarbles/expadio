import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { startWorkflow, transitionWorkflow, recordCaseDecision, makerForStage } from '../lib/workflow-runtime.ts';
import { assignParticipant } from '../lib/workflow-participants.ts';

/**
 * Fourth vertical, engine-level proof: an access request runs the same generic
 * runtime as cases, vendors and expenses, gated by role + separation of duties
 * only (no authority deriver). SECURITY_REVIEW is one stage exercising both
 * gates: a required "security_reviewer" blocks entry, and a decision blocks exit
 * to GRANTED — and the reviewer cannot be the requester who moved it there.
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

test('an access request runs the engine, gated by role + separation of duties', async () => {
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
    await c.query(`INSERT INTO platform.authorization_assignments (tenant_id, subject_id, role_id, status) VALUES ($1,$2,$3,'ACTIVE')`, [tenantId, s('reviewer'), roleId]);

    const reqId = (await c.query(
      `INSERT INTO platform.access_requests (tenant_id, requester_subject_id, resource, justification, blueprint_key)
       VALUES ($1, $2, 'prod-db:read', 'oncall', 'access.request') RETURNING access_request_id`,
      [tenantId, s('requester')],
    )).rows[0].access_request_id;

    const started = await startWorkflow(c, { tenantId, subjectType: 'access.request', subjectId: reqId, blueprintKey: 'access.request' });
    assert.ok(started.ok && started.instance.currentStageKey === 'SUBMITTED');
    const instanceId = started.instance.instanceId;
    let rev = started.instance.revision;

    // Participant gate: entering SECURITY_REVIEW needs a security_reviewer.
    const blocked = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: rev, toStageKey: 'SECURITY_REVIEW', requestedBySubjectId: s('requester') });
    assert.ok(blocked.ok === false && blocked.reason === 'GATE_BLOCKED'
      && blocked.blockers.some((b) => b.code === 'WORKFLOW_PARTICIPANT_ASSIGNMENT_MISSING'));

    await assignParticipant(c, { tenantId, instanceId, stageKey: 'SECURITY_REVIEW', participantKey: 'security_reviewer', targetKind: 'USER', targetKey: s('reviewer'), assignedBySubjectId: s('requester') });
    const toReview = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: rev, toStageKey: 'SECURITY_REVIEW', requestedBySubjectId: s('requester') });
    assert.ok(toReview.ok && toReview.instance.currentStageKey === 'SECURITY_REVIEW');
    rev = toReview.instance.revision;

    // Decision gate: GRANTED is blocked until an APPROVE is recorded.
    const gated = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: rev, toStageKey: 'GRANTED', requestedBySubjectId: s('reviewer') });
    assert.ok(gated.ok === false && gated.reason === 'GATE_BLOCKED');

    const maker = await makerForStage(c, { tenantId, instanceId, stageKey: 'SECURITY_REVIEW' });
    assert.equal(maker, s('requester'));

    // Separation of duties: the requester cannot approve their own access.
    const selfApprove = await recordCaseDecision(c, { tenantId, instanceId, workTypeKey: 'access.request', stageKey: 'SECURITY_REVIEW', outcome: 'APPROVE', approverSubjectId: s('requester'), makerSubjectId: maker });
    assert.ok(selfApprove.ok === false && selfApprove.reason === 'AUTHORITY_DENIED');

    // A governing, non-requester reviewer approves — no monetary requirement applies.
    const approved = await recordCaseDecision(c, { tenantId, instanceId, workTypeKey: 'access.request', stageKey: 'SECURITY_REVIEW', outcome: 'APPROVE', approverSubjectId: s('reviewer'), makerSubjectId: maker });
    assert.ok(approved.ok, 'a governing non-requester reviewer clears the gate');

    // With the decision recorded, reaching GRANTED auto-completes the instance.
    const granted = await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: rev, toStageKey: 'GRANTED', requestedBySubjectId: s('requester') });
    assert.ok(granted.ok && granted.instance.currentStageKey === 'GRANTED' && granted.instance.state === 'COMPLETED');
  } finally {
    c.release();
    await p.end();
  }
});
