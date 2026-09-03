import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const worker = readFileSync(
  new URL('../lib/governed-recovery-worker.ts', import.meta.url),
  'utf8',
);
const route = readFileSync(
  new URL('../app/api/internal/recovery/run/route.ts', import.meta.url),
  'utf8',
);

test('recovery worker uses lease-safe tenant-scoped claims', () => {
  assert.match(worker, /FOR UPDATE SKIP LOCKED/);
  assert.match(worker, /claim_token = \$3::uuid/);
  assert.match(worker, /claim_expires_at <= \$2::timestamptz/);
  assert.match(worker, /tenant_id = \$1::uuid/);
  assert.match(worker, /COMMAND_CLAIMED/);
  assert.match(worker, /RECOVERY_COMMAND_STALE_CLAIM/);
});

test('bounded recovery executor only requeues DEAD Domain Event outbox rows', () => {
  assert.match(worker, /claim\.commandType !== 'RETRY'/);
  assert.match(worker, /claim\.targetKind !== 'DOMAIN_EVENT_OUTBOX'/);
  assert.match(worker, /requeueDeadDomainEvent/);
  assert.match(worker, /DOMAIN_EVENT_OUTBOX_REQUEUED/);
  assert.doesNotMatch(worker, /UPDATE platform\.communication_deliveries/);
  assert.doesNotMatch(worker, /provider\.send/i);
  assert.doesNotMatch(worker, /ResendEmailAdapter/);
  assert.doesNotMatch(worker, /COMMUNICATION_PROVIDER_ATTEMPT/);
});

test('recovery target mutation and command completion are transactionally coupled', () => {
  const executeStart = worker.indexOf('export async function executeGovernedRecoveryCommand');
  const executeBlock = worker.slice(executeStart);
  assert.match(executeBlock, /await client\.query\('BEGIN'\)/);
  assert.match(executeBlock, /requeueDeadDomainEvent/);
  assert.match(executeBlock, /finishClaimedRecoveryCommand/);
  assert.match(executeBlock, /await client\.query\('COMMIT'\)/);
  assert.match(executeBlock, /await client\.query\('ROLLBACK'\)/);
});

test('internal recovery runner is machine authenticated, tenant bound, and bounded', () => {
  assert.match(route, /authenticateInternalWorkerRequest/);
  assert.match(route, /set_config\('app\.tenant_id', \$1, false\)/);
  assert.match(route, /RESET app\.tenant_id/);
  assert.match(route, /runGovernedRecoveryWorkerBatch/);
  assert.match(route, /const MAX_LIMIT = 50/);
  assert.doesNotMatch(route, /resolveRequestContext/);
});
