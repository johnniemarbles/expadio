import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const helper = read('../lib/governed-recovery-commands.ts');
const route = read('../app/api/recovery/commands/route.ts');

test('governed recovery command helper reads only the tenant-scoped command table', () => {
  assert.match(helper, /listGovernedRecoveryCommands/);
  assert.match(helper, /FROM platform\.governed_recovery_commands/);
  assert.match(helper, /tenant_id = \$1::uuid/);
  assert.match(helper, /LIMIT \$\$\{params\.length\}/);
  assert.match(helper, /clampGovernedRecoveryCommandLimit/);
  assert.doesNotMatch(helper, /UPDATE platform\./);
  assert.doesNotMatch(helper, /DELETE FROM platform\./);
  assert.doesNotMatch(helper, /INSERT INTO platform\./);
});

test('governed recovery command helper exposes bounded recovery vocabulary', () => {
  for (const commandType of ['RETRY', 'CANCEL', 'MARK_RESOLVED', 'CREATE_TASK_ESCALATION']) {
    assert.match(helper, new RegExp(commandType));
  }

  for (const targetKind of [
    'DOMAIN_EVENT_OUTBOX',
    'GOVERNED_ACTION',
    'SCHEDULED_GOVERNED_ACTION',
    'COMMUNICATION_DELIVERY',
    'COMMUNICATION_PROVIDER_ATTEMPT',
    'COMMUNICATION_PROVIDER_WEBHOOK_EVENT',
  ]) {
    assert.match(helper, new RegExp(targetKind));
  }

  for (const status of ['QUEUED', 'CLAIMED', 'SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELLED']) {
    assert.match(helper, new RegExp(status));
  }
});

test('governed recovery command route is governed, filterable, and read-only', () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /withTenantClient/);
  assert.match(route, /listGovernedRecoveryCommands/);
  assert.match(route, /status/);
  assert.match(route, /commandType/);
  assert.match(route, /targetKind/);
  assert.match(route, /correlationId/);
  assert.match(route, /limit/);
  assert.match(route, /Unsupported governed recovery command status/);
  assert.match(route, /Unsupported governed recovery command type/);
  assert.match(route, /Unsupported governed recovery target kind/);
  assert.doesNotMatch(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function PATCH/);
  assert.doesNotMatch(route, /export async function DELETE/);
  assert.doesNotMatch(route, /claimGovernedRecoveryCommand/);
  assert.doesNotMatch(route, /retry\(/i);
  assert.doesNotMatch(route, /cancel\(/i);
  assert.doesNotMatch(route, /provider\.send/i);
});
