import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { startWorkflow } from '../lib/workflow-runtime.ts';
import { assignParticipant } from '../lib/workflow-participants.ts';
import { loadPendingReviews } from '../lib/governance-pending-reviews.ts';

/**
 * The team-wide pending-review load lists open instances waiting on any named
 * person, and on whom, filterable by work type and assignee, dropping items once
 * a decision lands or the instance leaves the open states.
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

async function openVendorOn(c: pg.PoolClient, tenantId: string, name: string) {
  const vendorId = (await c.query(
    `INSERT INTO platform.vendors (tenant_id, legal_name, blueprint_key) VALUES ($1,$2,'vendor.onboarding') RETURNING vendor_id`,
    [tenantId, name],
  )).rows[0].vendor_id as string;
  const started = await startWorkflow(c, { tenantId, subjectType: 'vendor', subjectId: vendorId, blueprintKey: 'vendor.onboarding' });
  assert.ok(started.ok);
  const instanceId = started.instance.instanceId;
  const stageKey = (await c.query(`SELECT current_stage_key FROM platform.workflow_instances WHERE instance_id = $1`, [instanceId])).rows[0].current_stage_key as string;
  return { vendorId, instanceId, stageKey };
}

test('the pending load shows who each open item waits on, and filters and drains', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const alice = `user-${randomUUID()}`;
    const bob = `user-${randomUUID()}`;
    await c.query(`INSERT INTO platform.tenants (tenant_id, name) VALUES ($1, 'itest')`, [tenantId]);
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    const a = await openVendorOn(c, tenantId, 'Alice Co');
    const b = await openVendorOn(c, tenantId, 'Bob Co');
    await assignParticipant(c, { tenantId, instanceId: a.instanceId, stageKey: a.stageKey, participantKey: 'reviewer', targetKind: 'USER', targetKey: alice, assignedBySubjectId: alice });
    await assignParticipant(c, { tenantId, instanceId: b.instanceId, stageKey: b.stageKey, participantKey: 'reviewer', targetKind: 'USER', targetKey: bob, assignedBySubjectId: bob });

    // Both appear, each tagged with who it waits on.
    const all = await loadPendingReviews(c, {});
    const aItem = all.find((i) => i.subjectId === a.vendorId);
    const bItem = all.find((i) => i.subjectId === b.vendorId);
    assert.ok(aItem && aItem.assigneeSubjectId === alice, 'Alice\'s item is pending on Alice');
    assert.ok(bItem && bItem.assigneeSubjectId === bob, 'Bob\'s item is pending on Bob');

    // The assignee filter narrows to one person (random ids, so no global bleed).
    const onlyAlice = await loadPendingReviews(c, { assignee: alice });
    assert.ok(onlyAlice.length === 1 && onlyAlice[0].subjectId === a.vendorId, 'assignee filter narrows to Alice');

    // Once a decision is recorded for Alice's stage, her item drains off.
    await c.query(
      `INSERT INTO platform.workflow_stage_decisions
         (decision_id, tenant_id, instance_id, work_type_key, stage_key, outcome, decided_by_subject_id, decided_at, code, evidence_refs)
       VALUES ($1,$2,$3,'vendor.onboarding',$4,'APPROVE',$5, now(), 'WORKFLOW_DECISION_COMMITTED', ARRAY['itest:pending'])`,
      [randomUUID(), tenantId, a.instanceId, a.stageKey, alice],
    );
    assert.equal((await loadPendingReviews(c, { assignee: alice })).length, 0, 'a decided item leaves the pending load');

    // A terminal instance is excluded even while assigned.
    await c.query(`UPDATE platform.workflow_instances SET state='CANCELLED' WHERE instance_id=$1`, [b.instanceId]);
    assert.equal((await loadPendingReviews(c, { assignee: bob })).length, 0, 'a terminal item is excluded');
  } finally {
    c.release();
    await p.end();
  }
});
