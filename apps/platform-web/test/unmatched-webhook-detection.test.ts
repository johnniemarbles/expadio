import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const communicationHealthMigration = read('../../../infra/db/migrations/0080_communication_stuck_delivery_health.sql');
const communicationHealthSmoke = read('../../../infra/db/tests/communication_health_summary_smoke.sql');
const communicationHealthHelper = read('../lib/communication-health-summary.ts');

test('communication health read model detects unmatched provider webhooks', () => {
  assert.match(communicationHealthMigration, /communication_provider_webhooks_unmatched/);
  assert.match(communicationHealthMigration, /FROM platform\.communication_provider_webhook_events webhook/);
  assert.match(communicationHealthMigration, /webhook\.normalized_outcome = 'UNMATCHED'/);
  assert.match(communicationHealthMigration, /'sourceTable', 'platform\.communication_provider_webhook_events'/);
  assert.match(communicationHealthMigration, /'outcome', 'UNMATCHED'/);
  assert.match(communicationHealthMigration, /webhook\.tenant_id = platform\.current_tenant_id\(\)/);
});

test('communication health API vocabulary exposes the unmatched webhook detector', () => {
  assert.match(communicationHealthHelper, /communication_provider_webhooks_unmatched/);
  assert.match(communicationHealthHelper, /COMMUNICATION_HEALTH_KEYS/);
});

test('communication health smoke fixture exercises unmatched webhook detection', () => {
  assert.match(communicationHealthSmoke, /communication_provider_webhooks_unmatched/);
  assert.match(communicationHealthSmoke, /normalized_outcome, delivery_id/);
  assert.match(communicationHealthSmoke, /'UNMATCHED'/);
  assert.match(communicationHealthSmoke, /'PROVIDER_WEBHOOK_UNMATCHED'/);
  assert.match(communicationHealthSmoke, /delivery_id,\n\s+previous_delivery_state, new_delivery_state/);
});
