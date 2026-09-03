import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../../infra/db/migrations/0139_crm_lead_stage_governance.sql');
const route = read('../app/api/crm/leads/[id]/route.ts');

test('migration adds optimistic-concurrency revision and a hash-chained ledger', () => {
  assert.match(migration, /ADD COLUMN revision integer NOT NULL DEFAULT 1/);
  assert.match(migration, /CREATE TABLE platform\.crm_lead_stage_transitions/);
  assert.match(migration, /prev_hash text/);
  assert.match(migration, /entry_hash text NOT NULL/);
  assert.match(migration, /to_revision = from_revision \+ 1/);
  assert.match(migration, /UNIQUE \(lead_id, to_revision\)/);
  assert.match(migration, /crm_lead_stage_transitions_append_only/);
  assert.match(migration, /transition_kind <> 'OVERRIDE' OR btrim\(coalesce\(reason, ''\)\) <> ''/);
});

test('the route governs the transition instead of last-writer-wins', () => {
  assert.match(route, /decideLeadTransition/);
  assert.match(route, /leadTransitionEntryHash/);
  // Optimistic concurrency: update guarded by the revision it read.
  assert.match(route, /SET stage = \$2, revision = \$3[\s\S]*WHERE lead_id = \$1::uuid AND revision = \$4/);
  assert.match(route, /INSERT INTO platform\.crm_lead_stage_transitions/);
  assert.match(route, /REVISION_CONFLICT/);
  // No ungoverned bare stage write remains.
  assert.doesNotMatch(route, /SET stage = \$2, updated_at = now\(\)\s*\n\s*WHERE lead_id = \$1::uuid\s*\n\s*RETURNING/);
});
