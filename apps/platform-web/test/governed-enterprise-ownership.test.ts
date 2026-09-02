import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../../infra/db/migrations/0122_governed_enterprise_ownership.sql');
const runtime = read('../../../packages/postgres-runtime/src/enterprise-ownership.ts');
const requestRoute = read('../app/api/enterprise/ownership/requests/route.ts');
const decisionRoute = read('../app/api/enterprise/change-requests/[id]/decision/route.ts');
const portfolio = read('../app/api/enterprise/commercial/portfolio/route.ts');
const hub = read('../app/(shell)/enterprise/EnterpriseHub.tsx');

test('ownership persistence is normalized, effective-dated and approval governed', () => {
  assert.match(migration, /enterprise_change_request_id/);
  assert.match(migration, /status IN \('APPROVED','SUPERSEDED'\)/);
  assert.match(migration, /entity_ownership_interests_current_approved_uq/);
  assert.match(migration, /OWNERSHIP_EQUITY/);
  assert.match(migration, /OWNERSHIP_VOTING/);
  assert.match(migration, /OWNERSHIP_ECONOMIC/);
  assert.match(migration, /OWNERSHIP_CONTROL/);
  assert.match(migration, /OWNERSHIP_BENEFICIAL/);
  assert.doesNotMatch(migration, /DO \$\n/);
});

test('request replay identity includes dates and evidence', () => {
  assert.match(runtime, /requestFingerprint = JSON\.stringify/);
  assert.match(runtime, /validFrom: requestedValidFrom\?\.toISOString\(\) \?\? null/);
  assert.match(runtime, /validUntil: validUntil\?\.toISOString\(\) \?\? null/);
  assert.match(runtime, /evidenceRefs/);
  assert.match(runtime, /payload\.requestFingerprint === requestFingerprint/);
  assert.match(runtime, /ENTERPRISE_IDEMPOTENCY_KEY_CONFLICT/);
});

test('ownership approval proves SoD, supersession and typed graph publication', () => {
  assert.match(runtime, /ENTERPRISE_SEPARATION_OF_DUTIES_REQUIRED/);
  assert.match(runtime, /status = 'SUPERSEDED'/);
  assert.match(runtime, /SET valid_until = \$5::timestamptz/);
  assert.match(runtime, /updated_by_subject_id = \$6/);
  assert.doesNotMatch(runtime, /SET valid_until = \$6::timestamptz/);
  assert.match(runtime, /publishGovernedEntityRelationship/);
  assert.match(runtime, /relationshipKeyForInterestType/);
  assert.match(runtime, /enterprise\.ownership\.approved/);
});

test('ownership APIs remain scoped and Enterprise Hub exposes governed controls', () => {
  assert.match(requestRoute, /resolveRequestContext\(request\)/);
  assert.match(requestRoute, /withTenantTransaction\(context/);
  assert.match(decisionRoute, /decideEnterpriseOwnershipChange/);
  assert.match(portfolio, /listEnterpriseOwnershipInterests/);
  assert.match(hub, /Ownership change submitted for independent approval/);
  assert.match(hub, /CHANGE_OWNERSHIP/);
  assert.match(hub, /Ownership \/ Legal graph/);
});
