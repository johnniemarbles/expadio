import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { loadDecisionAnalytics } from '../lib/governance-analytics.ts';

/**
 * The decision analytics group the append-only decision log by work type and
 * compute an approval rate (approvals over total), under the tenant's RLS
 * context. The harness runs as a superuser so reads are global; the assertions
 * seed a distinct work type and check that vertical's own row.
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

test('analytics count decisions per work type and rate approvals', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const wt = `analytics.itest.${tenantId.slice(0, 8)}`;
    await c.query(`INSERT INTO platform.tenants (tenant_id, name) VALUES ($1, 'itest')`, [tenantId]);
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    // A workflow instance to hang decisions off (FK target), then 3 decisions on
    // this bespoke work type: 2 approvals, 1 rejection → 0.6667 approval rate.
    const instanceId = randomUUID();
    await c.query(
      `INSERT INTO platform.workflow_instances (instance_id, tenant_id, work_type_key, subject_type, subject_id, blueprint_key, blueprint_version, blueprint_scope, state, current_stage_key, revision, created_at, updated_at)
       VALUES ($1,$2,$3,'thing','s-1','bp',1,'PLATFORM','RUNNING','S1',1, now(), now())`,
      [instanceId, tenantId, wt],
    );
    const decide = (stage: string, outcome: string) => c.query(
      `INSERT INTO platform.workflow_stage_decisions
         (decision_id, tenant_id, instance_id, work_type_key, stage_key, outcome, decided_by_subject_id, decided_at, code, evidence_refs)
       VALUES ($1,$2,$3,$4,$5,$6,'approver', now(), 'WORKFLOW_DECISION_COMMITTED', ARRAY['itest:analytics'])`,
      [randomUUID(), tenantId, instanceId, wt, stage, outcome],
    );
    await decide('S1', 'APPROVE');
    await decide('S2', 'APPROVE');
    await decide('S3', 'REJECT');

    const stats = await loadDecisionAnalytics(c);
    const mine = stats.find((s) => s.workTypeKey === wt);
    assert.ok(mine, 'the seeded work type appears in the analytics');
    assert.equal(mine.total, 3);
    assert.equal(mine.approved, 2);
    assert.equal(mine.approvalRate, 0.6667);
  } finally {
    c.release();
    await p.end();
  }
});
