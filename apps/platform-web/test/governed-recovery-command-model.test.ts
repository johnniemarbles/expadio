import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../../../infra/db/migrations/0082_governed_recovery_commands.sql');
const smoke = read('../../../infra/db/tests/governed_recovery_commands_smoke.sql');

test('governed recovery commands are tenant-scoped platform command queue records', () => {
  assert.match(migration, /CREATE TABLE platform\.governed_recovery_commands/);
  assert.match(migration, /tenant_id uuid NOT NULL REFERENCES platform\.tenants/);
  assert.match(migration, /command_type text NOT NULL CHECK/);
  assert.match(migration, /target_kind text NOT NULL CHECK/);
  assert.match(migration, /idempotency_key text NOT NULL CHECK/);
  assert.match(migration, /UNIQUE \(tenant_id, idempotency_key\)/);
  assert.match(migration, /platform\.current_tenant_id\(\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
});

test('governed recovery command targets include provider evidence without mutating it', () => {
  for (const targetKind of [
    'DOMAIN_EVENT_OUTBOX',
    'GOVERNED_ACTION',
    'SCHEDULED_GOVERNED_ACTION',
    'COMMUNICATION_DELIVERY',
    'COMMUNICATION_PROVIDER_ATTEMPT',
    'COMMUNICATION_PROVIDER_WEBHOOK_EVENT',
  ]) {
    assert.match(migration, new RegExp(targetKind));
  }
});

test('governed recovery command events are append-only lifecycle evidence', () => {
  assert.match(migration, /CREATE TABLE platform\.governed_recovery_command_events/);
  assert.match(migration, /FOREIGN KEY \(recovery_command_id, tenant_id\)/);
  assert.match(migration, /reject_governed_recovery_command_event_mutation/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON platform\.governed_recovery_command_events/);
  assert.match(migration, /governed recovery command events are append-only/);
});

test('governed recovery model does not execute recovery side effects in the schema slice', () => {
  assert.doesNotMatch(migration, /UPDATE platform\.communication_deliveries/);
  assert.doesNotMatch(migration, /UPDATE platform\.domain_event_outbox/);
  assert.doesNotMatch(migration, /UPDATE platform\.communication_provider_attempts/);
  assert.doesNotMatch(migration, /UPDATE platform\.communication_provider_webhook_events/);
  assert.doesNotMatch(migration, /DELETE FROM platform\./);
  assert.doesNotMatch(migration, /PERFORM .*retry/i);
});

test('governed recovery smoke validates isolation, idempotency, lifecycle, and append-only events', () => {
  assert.match(smoke, /INSERT INTO platform\.governed_recovery_commands/);
  assert.match(smoke, /INSERT INTO platform\.governed_recovery_command_events/);
  assert.match(smoke, /unique_violation/);
  assert.match(smoke, /tenant isolation/);
  assert.match(smoke, /append-only/);
  assert.match(smoke, /UPDATE platform\.governed_recovery_commands/);
  assert.match(smoke, /ROLLBACK/);
});
