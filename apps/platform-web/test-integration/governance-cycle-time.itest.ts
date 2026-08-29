import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { loadDecisionCycleTime } from '../lib/governance-cycle-time.ts';

/**
 * Cycle time is the gap between entering a stage (its latest transition in) and
 * the decision on it, averaged per work type. The harness runs as a superuser so
 * reads are global; the assertions seed a distinct work type and check its row.
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

test('cycle time measures entry-to-decision per work type', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const wt = `cycle.itest.${tenantId.slice(0, 8)}`;
    await c.query(`INSERT INTO platform.tenants (tenant_id, name) VALUES ($1, 'itest')`, [tenantId]);
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    const instanceId = randomUUID();
    await c.query(
      `INSERT INTO platform.workflow_instances (instance_id, tenant_id, work_type_key, subject_type, subject_id, blueprint_key, blueprint_version, blueprint_scope, state, current_stage_key, revision, created_at, updated_at)
       VALUES ($1,$2,$3,'thing','s-1','bp',1,'PLATFORM','RUNNING','APPROVAL',1, now(), now())`,
      [instanceId, tenantId, wt],
    );
    // Entered APPROVAL two hours ago; decided now → ~7200s cycle time.
    await c.query(
      `INSERT INTO platform.workflow_instance_transitions (instance_id, tenant_id, from_stage_key, to_stage_key, from_state, to_state, revision, transitioned_by_subject_id, transitioned_at)
       VALUES ($1,$2,'REVIEW','APPROVAL','RUNNING','RUNNING',1,'maker', now() - interval '2 hours')`,
      [instanceId, tenantId],
    );
    await c.query(
      `INSERT INTO platform.workflow_stage_decisions
         (decision_id, tenant_id, instance_id, work_type_key, stage_key, outcome, decided_by_subject_id, decided_at, code, evidence_refs)
       VALUES ($1,$2,$3,$4,'APPROVAL','APPROVE','approver', now(), 'WORKFLOW_DECISION_COMMITTED', ARRAY['itest:cycle'])`,
      [randomUUID(), tenantId, instanceId, wt],
    );

    const rows = await loadDecisionCycleTime(c);
    const mine = rows.find((r) => r.workTypeKey === wt);
    assert.ok(mine, 'the seeded work type appears');
    assert.equal(mine.decided, 1);
    // ~2 hours, allowing a few seconds of clock drift during the test.
    assert.ok(Math.abs(mine.avgSeconds - 7_200) < 60, `avg ~2h, got ${mine.avgSeconds}s`);
    assert.ok(Math.abs(mine.maxSeconds - 7_200) < 60, `max ~2h, got ${mine.maxSeconds}s`);
  } finally {
    c.release();
    await p.end();
  }
});
