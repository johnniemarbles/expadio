import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const communicationHealthMigration = read('../../../infra/db/migrations/0081_communication_stale_provider_attempt_health.sql');
const communicationHealthSmoke = read('../../../infra/db/tests/communication_health_summary_smoke.sql');
const communicationHealthHelper = read('../lib/communication-health-summary.ts');

test('communication health read model detects stale accepted provider attempts', () => {
  assert.match(communicationHealthMigration, /communication_provider_attempts_stale_acceptance/);
  assert.match(communicationHealthMigration, /FROM platform\.communication_provider_attempts attempt/);
  assert.match(communicationHealthMigration, /JOIN platform\.communication_deliveries delivery/);
  assert.match(communicationHealthMigration, /attempt\.outcome = 'ACCEPTED'/);
  assert.match(communicationHealthMigration, /attempt\.completed_at <= clock_timestamp\(\) - interval '5 minutes'/);
  assert.match(communicationHealthMigration, /delivery\.provider_message_id IS DISTINCT FROM attempt\.provider_message_id/);
  assert.match(communicationHealthMigration, /delivery\.state = 'PENDING'/);
  assert.match(communicationHealthMigration, /attempt\.tenant_id = platform\.current_tenant_id\(\)/);
});

test('communication health API vocabulary exposes stale provider attempt detection', () => {
  assert.match(communicationHealthHelper, /communication_provider_attempts_stale_acceptance/);
  assert.match(communicationHealthHelper, /COMMUNICATION_HEALTH_KEYS/);
});

test('communication health smoke fixture exercises stale accepted provider attempts', () => {
  assert.match(communicationHealthSmoke, /communication_provider_attempts_stale_acceptance/);
  assert.match(communicationHealthSmoke, /communication-health-stale-accepted-attempt/);
  assert.match(communicationHealthSmoke, /'ACCEPTED'/);
  assert.match(communicationHealthSmoke, /provider-health-stale-acceptance/);
  assert.match(communicationHealthSmoke, /metadata -> 'deliveryStates' \? 'PENDING'/);
});
