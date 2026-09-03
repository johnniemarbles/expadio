import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const inbox = read('../app/api/leads/capture/route.ts');
const detail = read('../app/api/leads/capture/[id]/route.ts');
const stage = read('../app/api/leads/capture/[id]/stage/route.ts');
const status = read('../app/api/leads/capture/[id]/status/route.ts');
const migration = read('../../../infra/db/migrations/0127_demand_capture_stage_lifecycle.sql');

test('Brand Demand Capture reads stay inside selected workspace RLS', () => {
  for (const source of [inbox, detail]) {
    assert.match(source, /resolveBrandContext\(\)/);
    assert.match(source, /withBrandTransaction/);
    assert.match(source, /platform\.lead_capture_leads/);
    assert.doesNotMatch(source, /body\.tenantId/);
    assert.doesNotMatch(source, /body\.organizationId/);
  }
  assert.match(detail, /lead_capture_stage_history/);
  assert.match(detail, /lead_capture_status_history/);
});

test('stage and status mutations use governed actor context, never request authority scope', () => {
  for (const source of [stage, status]) {
    assert.match(source, /hasBrandGovernanceForOrganization/);
    assert.match(source, /app\.lead_capture_transition_actor/);
    assert.match(source, /context\.subjectId/);
    assert.doesNotMatch(source, /body\.tenantId/);
    assert.doesNotMatch(source, /body\.organizationId/);
    assert.doesNotMatch(source, /body\.actorSubjectId/);
  }
  assert.match(stage, /CLOSE_REASON_REQUIRED/);
  assert.match(stage, /TRANSITION_REASON_REQUIRED/);
  assert.match(status, /STATUS_REASON_REQUIRED/);
  assert.match(status, /TERMINAL_STAGE_STATUS_LOCKED/);
});

test('database records every lifecycle mutation and fails closed on non-standard stage moves', () => {
  assert.match(migration, /lead_capture_standard_next_stage/);
  assert.match(migration, /non-standard lead capture stage transition requires reason/);
  assert.match(migration, /terminal lead capture stage requires close reason/);
  assert.match(migration, /lead_capture_stage_history/);
  assert.match(migration, /lead_capture_status_history/);
  assert.match(migration, /append-only/);
  assert.match(migration, /BEFORE UPDATE OF stage/);
  assert.match(migration, /AFTER UPDATE OF stage/);
  assert.match(migration, /BEFORE UPDATE OF status/);
  assert.match(migration, /AFTER UPDATE OF status/);
  assert.doesNotMatch(migration, /DELETE FROM platform\.lead_capture_stage_history/);
});
