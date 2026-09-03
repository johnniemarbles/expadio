import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../../infra/db/migrations/0128_demand_capture_routing.sql', import.meta.url),
  'utf8',
);

test('Demand Capture routing is deterministic and organization scoped', () => {
  assert.match(migration, /lead_capture_routing_rules/);
  assert.match(migration, /UNIQUE \(tenant_id, organization_id, priority\)/);
  assert.match(migration, /source_id uuid/);
  assert.match(migration, /target_subject_id text NOT NULL/);
  assert.match(migration, /current_context_can_access_organization/);
});

test('routing targets are validated without changing the current request subject', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION platform\.subject_can_access_organization/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /membership\.subject_id = p_subject_id/);
  assert.match(migration, /membership\.issuer IS NOT DISTINCT FROM p_issuer/);
  assert.doesNotMatch(migration, /set_config\('app\.subject_id'/);
});

test('assignment results are append-only and UNASSIGNED is first-class', () => {
  assert.match(migration, /lead_capture_assignment_events/);
  assert.match(migration, /outcome IN \('ASSIGNED','UNASSIGNED'\)/);
  assert.match(migration, /lead capture assignment events are append-only/);
  assert.match(migration, /BEFORE UPDATE OR DELETE/);
  assert.match(migration, /UNASSIGNED is an explicit auditable result/);
});
