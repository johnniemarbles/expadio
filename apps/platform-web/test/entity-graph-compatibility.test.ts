import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../../infra/db/migrations/0121_entity_graph_compatibility.sql', import.meta.url),
  'utf8',
);

test('graph reads remain fail-closed until a drift-free proof exists', () => {
  assert.match(migration, /graph_reads_enabled boolean NOT NULL DEFAULT false/);
  assert.match(migration, /CHECK \(NOT graph_reads_enabled OR drift_free_at IS NOT NULL\)/);
  assert.match(migration, /FOR SELECT/);
  assert.doesNotMatch(migration, /FOR (?:INSERT|UPDATE|ALL)/);
});

test('operational compatibility compares effective graph paths with closure', () => {
  assert.match(migration, /compare_operational_graph_to_legacy/);
  assert.match(migration, /platform\.organization_closure/);
  assert.match(migration, /relationship\.valid_from <= p_as_of/);
  assert.match(migration, /relationship\.valid_until IS NULL OR relationship\.valid_until > p_as_of/);
  assert.match(migration, /GRAPH_ONLY/);
  assert.match(migration, /LEGACY_ONLY/);
  assert.match(migration, /DEPTH_MISMATCH/);
});

test('compatibility traversal is cycle- and depth-bounded', () => {
  assert.match(migration, /walk\.depth < 32/);
  assert.match(migration, /NOT target_org\.organization_id = ANY\(walk\.visited\)/);
});
