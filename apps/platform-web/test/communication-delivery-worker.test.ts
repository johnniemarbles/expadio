import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const worker = readFileSync(
  new URL('../lib/communication-delivery-worker.ts', import.meta.url),
  'utf8',
);
const route = readFileSync(
  new URL('../app/api/internal/communications/run/route.ts', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL('../../../infra/db/migrations/0070_communication_delivery_worker.sql', import.meta.url),
  'utf8',
);
const adapter = readFileSync(
  new URL('../../../packages/communication/src/governed-action-adapter.ts', import.meta.url),
  'utf8',
);

test('delivery execution stays on the existing communication_deliveries queue', () => {
  assert.match(migration, /ALTER TABLE platform\.communication_deliveries/);
  assert.match(migration, /dispatch_snapshot jsonb/);
  assert.match(migration, /claim_token uuid/);
  assert.match(migration, /next_attempt_at timestamptz/);
  assert.doesNotMatch(migration, /CREATE TABLE platform\.communication_delivery_queue/i);
  assert.doesNotMatch(migration, /CREATE TABLE platform\.communication_jobs/i);
});

test('queue phase persists immutable provider-neutral execution input', () => {
  assert.match(adapter, /dispatchSnapshot/);
  assert.match(adapter, /dispatch: preparedDispatch/);
  assert.match(adapter, /consentRequired: config\.consentRequired/);
  assert.match(migration, /dispatch snapshots are immutable/);
});

test('worker claim is lease-safe and provider call is outside the claim transaction', () => {
  assert.match(worker, /FOR UPDATE SKIP LOCKED/);
  assert.match(worker, /claim_expires_at/);
  assert.match(worker, /claim_token = \$3::uuid/);
  assert.match(worker, /DELIVERY_CLAIMED/);
  assert.match(worker, /claim_token = \$3::uuid[\s\S]*claim_expires_at > \$6::timestamptz/);
  assert.match(worker, /ResendEmailAdapter/);
});

test('worker rechecks compliance and uses governed service credential lease', () => {
  assert.match(worker, /evaluatePersistedCommunicationPreflight/);
  assert.match(worker, /PostgresCommunicationSuppressionRepository/);
  assert.match(worker, /PostgresCommunicationConsentRepository/);
  assert.match(worker, /actorKind: 'service'/);
  assert.match(worker, /createGovernedCredentialLeaseRuntime/);
  assert.match(worker, /governedResendApiTokenProvider/);
});

test('internal runner is machine authenticated, tenant bound and bounded', () => {
  assert.match(route, /authenticateInternalWorkerRequest/);
  assert.match(route, /EXPADIO_COMMUNICATION_WORKER_SUBJECT_ID/);
  assert.match(route, /MAX_LIMIT = 100/);
  assert.match(route, /set_config\('app\.tenant_id'/);
  assert.match(route, /RESET app\.tenant_id/);
});
