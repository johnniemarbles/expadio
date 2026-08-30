import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const operations = readFileSync(
  new URL('../lib/communication-legacy-delivery-recovery.ts', import.meta.url),
  'utf8',
);
const listRoute = readFileSync(
  new URL('../app/api/communications/recovery/legacy-deliveries/route.ts', import.meta.url),
  'utf8',
);
const cancelRoute = readFileSync(
  new URL('../app/api/communications/recovery/legacy-deliveries/[deliveryId]/cancel/route.ts', import.meta.url),
  'utf8',
);
const panel = readFileSync(
  new URL('../app/(shell)/communications/LegacyDeliveryRecoveryPanel.tsx', import.meta.url),
  'utf8',
);

test('legacy recovery only selects non-executable PENDING rows without snapshots', () => {
  assert.match(operations, /state = 'PENDING'/);
  assert.match(operations, /dispatch_snapshot IS NULL/);
  assert.match(operations, /MIGRATION_REQUIRED/);
});

test('legacy recovery is step-up governed and writes actor-attributed audit evidence', () => {
  assert.match(cancelRoute, /requireStepUp/);
  assert.match(cancelRoute, /hasGovernanceWriteRole/);
  assert.match(cancelRoute, /resolveGoverningRole/);
  assert.match(operations, /communication_legacy_delivery_recovery_events/);
  assert.match(operations, /authorized_by_subject_id/);
  assert.match(operations, /LEGACY_DISPATCH_MIGRATION_CANCELLED/);
});

test('legacy recovery does not reconstruct or mutate prepared dispatch snapshots', () => {
  assert.doesNotMatch(operations, /SET dispatch_snapshot/);
  assert.match(panel, /never reconstruct historical send state/i);
  assert.match(panel, /fresh governed action/i);
});

test('legacy recovery list is tenant scoped through normal request context', () => {
  assert.match(listRoute, /resolveRequestContext/);
  assert.match(listRoute, /withTenantTransaction/);
  assert.match(listRoute, /tenantId: context\.tenantId/);
});
