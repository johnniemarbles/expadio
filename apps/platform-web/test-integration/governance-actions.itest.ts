import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { startWorkflow, transitionWorkflow } from '../lib/workflow-runtime.ts';
import { resolveInstanceForSubject, availableActions, decideOnSubject, assignOnSubject } from '../lib/governance-actions.ts';

/**
 * The cross-vertical action layer resolves any subject to its instance and
 * derives the governed actions its current stage permits — DECIDE for a
 * decision-required stage, ASSIGN for an unfilled slot — plus a canAdvance
 * status when a gate-free stage is ready to move on (advancing itself is a
 * vertical action, not a queue one). Read-only.
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

test('actions resolve any subject to its instance and derive stage gates', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    await c.query(`INSERT INTO platform.tenants (tenant_id, name) VALUES ($1, 'itest')`, [tenantId]);
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    const vendorId = (await c.query(
      `INSERT INTO platform.vendors (tenant_id, legal_name, blueprint_key) VALUES ($1,'Actions Co','vendor.onboarding') RETURNING vendor_id`,
      [tenantId],
    )).rows[0].vendor_id as string;
    const started = await startWorkflow(c, { tenantId, subjectType: 'vendor', subjectId: vendorId, blueprintKey: 'vendor.onboarding' });
    assert.ok(started.ok);
    const instanceId = started.instance.instanceId;
    // The route writes the instance id back onto the subject row; mirror that.
    await c.query(
      `UPDATE platform.vendors SET workflow_instance_id = $2::uuid, stage_key = $3 WHERE vendor_id = $1::uuid`,
      [vendorId, instanceId, started.instance.currentStageKey ?? null],
    );

    // Generic resolution: work type + subject → instance; unknown → null.
    assert.equal(await resolveInstanceForSubject(c, { workTypeKey: 'vendor.onboarding', subjectId: vendorId }), instanceId);
    assert.equal(await resolveInstanceForSubject(c, { workTypeKey: 'no.such.type', subjectId: vendorId }), null);
    assert.equal(await resolveInstanceForSubject(c, { workTypeKey: 'vendor.onboarding', subjectId: randomUUID() }), null);

    // At the open first stage (no gates), the stage is ready to advance — a
    // status, not an action (advancing happens in the vertical). The actionable
    // set stays an exact projection of the mutation endpoint (DECIDE/ASSIGN only).
    const atStart = await availableActions(c, { tenantId, workTypeKey: 'vendor.onboarding', subjectId: vendorId });
    assert.ok(atStart, 'the started instance resolves to an actions descriptor');
    assert.equal(atStart.instanceId, instanceId);
    assert.equal(atStart.state, 'RUNNING');
    assert.equal(atStart.canAdvance, true, 'an open gate-free stage is ready to advance');
    assert.ok(atStart.actions.every((a) => a.type === 'DECIDE' || a.type === 'ASSIGN'), 'only DECIDE/ASSIGN are advertised as actions');

    // Move the instance to the decision-required APPROVAL stage: DECIDE is offered.
    await c.query(`UPDATE platform.workflow_instances SET current_stage_key = 'APPROVAL' WHERE instance_id = $1`, [instanceId]);
    const atApproval = await availableActions(c, { tenantId, workTypeKey: 'vendor.onboarding', subjectId: vendorId });
    assert.ok(atApproval);
    const decide = atApproval.actions.find((a) => a.type === 'DECIDE');
    assert.ok(decide && decide.type === 'DECIDE' && decide.outcomes.length > 0, 'a decision-required stage offers DECIDE with outcomes');
    assert.equal(atApproval.canAdvance, false, 'a stage awaiting a decision is not ready to advance');
  } finally {
    c.release();
    await p.end();
  }
});

test('a governed action decides and assigns cross-vertically, with SoD', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const maker = `maker-${randomUUID()}`;
    const approver = `approver-${randomUUID()}`;
    await c.query(`INSERT INTO platform.tenants (tenant_id, name) VALUES ($1, 'itest')`, [tenantId]);
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    // Both maker and approver hold a governing role, so the only thing that can
    // deny the maker is separation of duties (not a missing role).
    const roleId = (await c.query(
      `INSERT INTO platform.authorization_roles (role_key, display_name, ownership_scope, tenant_id) VALUES ('TENANT_ADMIN','Admin','TENANT',$1) RETURNING role_id`,
      [tenantId],
    )).rows[0].role_id as string;
    for (const subject of [maker, approver]) {
      await c.query(`INSERT INTO platform.authorization_assignments (tenant_id, subject_id, role_id, status) VALUES ($1,$2,$3,'ACTIVE')`, [tenantId, subject, roleId]);
    }

    const vendorId = (await c.query(
      `INSERT INTO platform.vendors (tenant_id, legal_name, blueprint_key) VALUES ($1,'Decide Co','vendor.onboarding') RETURNING vendor_id`,
      [tenantId],
    )).rows[0].vendor_id as string;
    const started = await startWorkflow(c, { tenantId, subjectType: 'vendor', subjectId: vendorId, blueprintKey: 'vendor.onboarding' });
    assert.ok(started.ok);
    const instanceId = started.instance.instanceId;
    await c.query(`UPDATE platform.vendors SET workflow_instance_id = $2::uuid WHERE vendor_id = $1::uuid`, [vendorId, instanceId]);

    // ASSIGN the screener slot via the generic action, then drive to APPROVAL.
    const assigned = await assignOnSubject(c, {
      tenantId, workTypeKey: 'vendor.onboarding', subjectId: vendorId,
      stageKey: 'SCREENING', participantKey: 'screener', targetKind: 'USER', targetKey: `carol-${randomUUID()}`, assignedBySubjectId: maker,
    });
    assert.ok(assigned.ok && assigned.assigned.ok, 'the screener slot is filled by the generic ASSIGN');

    let rev = started.instance.revision;
    rev = (await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: rev, toStageKey: 'SCREENING', requestedBySubjectId: maker }) as { instance: { revision: number } }).instance.revision;
    await transitionWorkflow(c, { tenantId, instanceId, expectedRevision: rev, toStageKey: 'APPROVAL', requestedBySubjectId: maker });

    // Separation of duties: the maker who moved it into APPROVAL cannot approve.
    const sod = await decideOnSubject(c, { tenantId, workTypeKey: 'vendor.onboarding', subjectId: vendorId, outcome: 'APPROVE', approverSubjectId: maker });
    assert.ok(sod.ok === false && sod.reason === 'AUTHORITY_DENIED', 'the maker is denied by separation of duties');

    // A different approver clears it, cross-vertical, through the same capture.
    const ok = await decideOnSubject(c, { tenantId, workTypeKey: 'vendor.onboarding', subjectId: vendorId, outcome: 'APPROVE', approverSubjectId: approver });
    assert.ok(ok.ok === true && ok.status === 'COMMITTED', 'a governing non-maker records the decision');

    const logged = await c.query(
      `SELECT outcome, decided_by_subject_id FROM platform.workflow_stage_decisions WHERE instance_id = $1 AND stage_key = 'APPROVAL'`,
      [instanceId],
    );
    assert.equal(logged.rows.length, 1);
    assert.equal(logged.rows[0].outcome, 'APPROVE');
    assert.equal(logged.rows[0].decided_by_subject_id, approver);
  } finally {
    c.release();
    await p.end();
  }
});
