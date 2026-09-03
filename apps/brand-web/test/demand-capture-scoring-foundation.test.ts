import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../../infra/db/migrations/0129_demand_capture_scoring_foundation.sql', import.meta.url),
  'utf8',
);

test('Demand Capture qualification and scoring are versioned organization-scoped contracts', () => {
  assert.match(migration, /lead_qualification_templates/);
  assert.match(migration, /lead_qualifications/);
  assert.match(migration, /lead_scoring_profiles/);
  assert.match(migration, /lead_scores/);
  assert.match(migration, /lead_score_components/);
  assert.match(migration, /UNIQUE \(tenant_id, organization_id, template_key, version\)/);
  assert.match(migration, /UNIQUE \(tenant_id, organization_id, profile_key, version\)/);
  assert.match(migration, /WHERE status = 'ACTIVE'/);
  assert.match(migration, /current_context_can_access_organization/);
});

test('score and qualification evidence is immutable and current score is derived', () => {
  assert.match(migration, /lead_qualifications_append_only/);
  assert.match(migration, /lead_scores_append_only/);
  assert.match(migration, /lead_score_components_append_only/);
  assert.match(migration, /BEFORE UPDATE OR DELETE/);
  assert.match(migration, /Current score is the latest snapshot/);
  assert.doesNotMatch(migration, /is_current/);
});

test('scoring persistence carries explainable component evidence', () => {
  assert.match(migration, /component_key text NOT NULL/);
  assert.match(migration, /raw_value jsonb NOT NULL/);
  assert.match(migration, /weight numeric/);
  assert.match(migration, /points_awarded numeric/);
  assert.match(migration, /points_possible numeric/);
  assert.match(migration, /explanation text NOT NULL/);
  assert.match(migration, /calculation_reason text NOT NULL/);
});
