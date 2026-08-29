import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { startWorkflow } from '../lib/workflow-runtime.ts';
import { assignParticipant } from '../lib/workflow-participants.ts';
import { loadReviewQueue } from '../lib/governance-review-queue.ts';

/**
 * The review queue lists open instances waiting on a participant to act: it
 * appears when they are the assigned USER on the instance's current stage and no
 * decision has been recorded, and drops out once a decision lands, once someone
 * else is the assignee, or once the instance leaves the open states.
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

test('the queue surfaces work assigned to me and pending, and nothing else', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const me = `user-${randomUUID()}`;
    const someoneElse = `user-${randomUUID()}`;
    await c.query(`INSERT INTO platform.tenants (tenant_id, name) VALUES ($1, 'itest')`, [tenantId]);
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    // An open vendor instance; assign me to the stage it currently sits at.
    const vendorId = (await c.query(
      `INSERT INTO platform.vendors (tenant_id, legal_name, blueprint_key) VALUES ($1,'Waiting Co','vendor.onboarding') RETURNING vendor_id`,
      [tenantId],
    )).rows[0].vendor_id;
    const started = await startWorkflow(c, { tenantId, subjectType: 'vendor', subjectId: vendorId, blueprintKey: 'vendor.onboarding' });
    assert.ok(started.ok);
    const instanceId = started.instance.instanceId;
    const stageKey = (await c.query(
      `SELECT current_stage_key FROM platform.workflow_instances WHERE instance_id = $1`,
      [instanceId],
    )).rows[0].current_stage_key as string;

    const assigned = await assignParticipant(c, {
      tenantId, instanceId, stageKey, participantKey: 'reviewer',
      targetKind: 'USER', targetKey: me, assignedBySubjectId: me,
    });
    assert.ok(assigned.ok);

    // It is on my queue, tagged with the stage and slot; not on anyone else's.
    const mine = await loadReviewQueue(c, { subjectId: me });
    const item = mine.find((i) => i.subjectId === vendorId);
    assert.ok(item, 'the instance assigned to me and awaiting action is on my queue');
    assert.equal(item.currentStageKey, stageKey);
    assert.equal(item.participantKey, 'reviewer');
    assert.equal(item.workTypeKey, 'vendor.onboarding');
    assert.equal((await loadReviewQueue(c, { subjectId: someoneElse })).length, 0, 'it is not on another subject\'s queue');

    // Once a decision is recorded for that stage, it leaves my queue.
    await c.query(
      `INSERT INTO platform.workflow_stage_decisions
         (decision_id, tenant_id, instance_id, work_type_key, stage_key, outcome, decided_by_subject_id, decided_at, code, evidence_refs)
       VALUES ($1,$2,$3,'vendor.onboarding',$4,'APPROVE',$5, now(), 'WORKFLOW_DECISION_COMMITTED', ARRAY['itest:review-queue'])`,
      [randomUUID(), tenantId, instanceId, stageKey, me],
    );
    assert.ok(!(await loadReviewQueue(c, { subjectId: me })).some((i) => i.subjectId === vendorId), 'a decided stage drops off the queue');

    // A second instance assigned to me but driven terminal is also excluded.
    const doneVendor = (await c.query(
      `INSERT INTO platform.vendors (tenant_id, legal_name, blueprint_key) VALUES ($1,'Done Co','vendor.onboarding') RETURNING vendor_id`,
      [tenantId],
    )).rows[0].vendor_id;
    const started2 = await startWorkflow(c, { tenantId, subjectType: 'vendor', subjectId: doneVendor, blueprintKey: 'vendor.onboarding' });
    assert.ok(started2.ok);
    const stage2 = (await c.query(`SELECT current_stage_key FROM platform.workflow_instances WHERE instance_id = $1`, [started2.instance.instanceId])).rows[0].current_stage_key as string;
    await assignParticipant(c, { tenantId, instanceId: started2.instance.instanceId, stageKey: stage2, participantKey: 'reviewer', targetKind: 'USER', targetKey: me, assignedBySubjectId: me });
    await c.query(`UPDATE platform.workflow_instances SET state='CANCELLED' WHERE instance_id=$1`, [started2.instance.instanceId]);
    assert.ok(!(await loadReviewQueue(c, { subjectId: me })).some((i) => i.subjectId === doneVendor), 'a terminal instance is excluded even when assigned to me');
  } finally {
    c.release();
    await p.end();
  }
});
