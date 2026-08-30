import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const schedulerHealthMigration = read('../../../infra/db/migrations/0078_scheduler_health_summary.sql');
const schedulerHealthSmoke = read('../../../infra/db/tests/scheduler_health_summary_smoke.sql');
const schedulerHealthHelper = read('../lib/scheduler-health-summary.ts');

test('scheduler health read model detects due unmaterialized scheduled actions', () => {
  assert.match(schedulerHealthMigration, /scheduler_scheduled_actions_due_unmaterialized/);
  assert.match(schedulerHealthMigration, /FROM platform\.scheduled_governed_actions/);
  assert.match(schedulerHealthMigration, /child_action_intent_id IS NULL/);
  assert.match(schedulerHealthMigration, /COALESCE\(next_attempt_at, due_at\) <= clock_timestamp\(\)/);
  assert.match(schedulerHealthMigration, /state NOT IN \('MATERIALIZED', 'CANCELLED'\)/);
  assert.match(schedulerHealthMigration, /'sourceTable', 'platform\.scheduled_governed_actions'/);
  assert.match(schedulerHealthMigration, /'states', jsonb_object_agg\(scheduled\.state/);
});

test('scheduler health API vocabulary exposes the due scheduled action detector', () => {
  assert.match(schedulerHealthHelper, /scheduler_scheduled_actions_due_unmaterialized/);
  assert.match(schedulerHealthHelper, /SCHEDULER_HEALTH_KEYS/);
});

test('scheduler health smoke fixture exercises the due scheduled action detector', () => {
  assert.match(schedulerHealthSmoke, /INSERT INTO platform\.scheduled_governed_actions/);
  assert.match(schedulerHealthSmoke, /scheduler_scheduled_actions_due_unmaterialized/);
  assert.match(schedulerHealthSmoke, /child_action_intent_id/);
  assert.match(schedulerHealthSmoke, /'PENDING'/);
});
