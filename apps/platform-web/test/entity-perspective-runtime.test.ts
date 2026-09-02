import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

const perspectives = read('../../../packages/relationship/src/perspectives.ts');
const relationship = read('../../../packages/relationship/src/index.ts');
const repository = read('../../../packages/postgres-runtime/src/entity-relationship.ts');
const migration = read('../../../infra/db/migrations/0118_entity_relationship_perspective_projection.sql');

test('five perspective names are canonical across TypeScript and PostgreSQL', () => {
  for (const value of [
    'GOVERNANCE',
    'OWNERSHIP_LEGAL',
    'COMMERCIAL',
    'TERRITORY_JURISDICTION',
    'OPERATIONAL',
  ]) {
    assert.match(perspectives, new RegExp(`'${value}'`));
    assert.match(migration, new RegExp(`'${value}'`));
  }
  assert.doesNotMatch(perspectives, /'TERRITORY'/);
  assert.match(migration, /SET perspective = 'TERRITORY_JURISDICTION'[\s\S]*WHERE perspective = 'TERRITORY'/);
});

test('relationship perspective is governed catalog state, not free-form attributes', () => {
  assert.match(relationship, /readonly perspective: RelationshipPerspective \| null/);
  assert.doesNotMatch(perspectives, /attributes\.perspectives/);
  assert.match(repository, /definition\.perspective AS perspective/);
});

test('unclassified legacy edges fail closed for perspective decisions', () => {
  assert.match(
    perspectives,
    /relationship\.perspective === perspective[\s\S]*includeUnclassified === true/,
  );
  assert.match(
    migration,
    /NULL means legacy\/unclassified and is excluded from perspective projections/,
  );
});

test('runtime exposes an indexed perspective-aware active edge query', () => {
  assert.match(repository, /async listActiveByPerspective/);
  assert.match(repository, /definition\.perspective = \$2/);
  assert.match(repository, /relationship\.status = 'ACTIVE'/);
  assert.match(repository, /relationship\.valid_until IS NULL/);
  assert.match(migration, /entity_relationship_definitions_perspective_lookup_idx/);
  assert.match(migration, /entity_relationships_active_definition_lookup_idx/);
});

test('legacy backfill only classifies provable catalog matches', () => {
  assert.match(migration, /relationship\.definition_id IS NULL/);
  assert.match(migration, /definition\.relationship_key = relationship\.relationship_key/);
  assert.match(migration, /definition\.source_node_type = relationship\.source_entity_type/);
  assert.match(migration, /definition\.target_node_type = relationship\.target_entity_type/);
  assert.match(migration, /CASE WHEN definition\.tenant_id = relationship\.tenant_id THEN 0 ELSE 1 END/);
});
