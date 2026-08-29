import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { startWorkflow } from '../lib/workflow-runtime.ts';
import { resolveInstanceForSubject, availableActions } from '../lib/governance-actions.ts';

/**
 * The cross-vertical action layer resolves any subject to its instance and
 * derives the governed actions its current stage permits — ADVANCE for an open
 * gate-free stage, DECIDE for a decision-required one — read-only.
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

    // At the open first stage (no gates), ADVANCE is offered.
    const atStart = await availableActions(c, { tenantId, workTypeKey: 'vendor.onboarding', subjectId: vendorId });
    assert.ok(atStart, 'the started instance resolves to an actions descriptor');
    assert.equal(atStart.instanceId, instanceId);
    assert.equal(atStart.state, 'RUNNING');
    assert.ok(atStart.actions.some((a) => a.type === 'ADVANCE'), 'an open gate-free stage can advance');

    // Move the instance to the decision-required APPROVAL stage: DECIDE is offered.
    await c.query(`UPDATE platform.workflow_instances SET current_stage_key = 'APPROVAL' WHERE instance_id = $1`, [instanceId]);
    const atApproval = await availableActions(c, { tenantId, workTypeKey: 'vendor.onboarding', subjectId: vendorId });
    assert.ok(atApproval);
    const decide = atApproval.actions.find((a) => a.type === 'DECIDE');
    assert.ok(decide && decide.type === 'DECIDE' && decide.outcomes.length > 0, 'a decision-required stage offers DECIDE with outcomes');
  } finally {
    c.release();
    await p.end();
  }
});
