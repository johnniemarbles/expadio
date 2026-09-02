import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../../../infra/db/migrations/0120_enterprise_graph_publication.sql');
const graph = read('../../../packages/postgres-runtime/src/entity-graph.ts');
const enterprise = read('../../../packages/postgres-runtime/src/enterprise.ts');
const onboarding = read('../../../packages/postgres-runtime/src/enterprise-onboarding.ts');
const commercial = read('../../../packages/postgres-runtime/src/enterprise-commercial.ts');
const rightsRoute = read('../app/api/enterprise/commercial/appointments/[id]/rights/route.ts');
const jurisdictionRoute = read('../app/api/enterprise/commercial/jurisdictions/[id]/activate/route.ts');

test('derived enterprise graph publication has explicit domain vocabulary', () => {
  assert.match(migration, /'OPERATED_BY'/);
  assert.match(migration, /'OPERATIONAL'/);
  assert.match(migration, /'MANY_TO_ONE'/);
  assert.match(enterprise, /relationshipKey: 'OPERATIONAL_PARENT'/);
  assert.match(onboarding, /relationshipKey: 'OPERATED_BY'/);
  assert.match(commercial, /relationshipKey: 'TERRITORIAL_JURISDICTION'/);
});

test('graph publication delegates registry, cardinality and idempotency to the database boundary', () => {
  assert.match(graph, /platform\.create_governed_entity_relationship/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /IF existing_id IS NOT NULL THEN[\s\S]*RETURN existing_id/);
  assert.match(migration, /resolve_or_register_entity_registry_node/);
});

test('authoritative enterprise mutations publish within their transaction-owned runtime', () => {
  assert.match(enterprise, /INSERT INTO platform\.organizations[\s\S]*publishGovernedEntityRelationship/);
  assert.match(onboarding, /INSERT INTO platform\.organization_legal_entity_bindings[\s\S]*publishGovernedEntityRelationship/);
  assert.match(commercial, /UPDATE platform\.enterprise_jurisdiction_activations[\s\S]*publishGovernedEntityRelationship/);
});

test('current commercial APIs use the package runtime that publishes graph state', () => {
  assert.match(rightsRoute, /@expadio\/postgres-runtime\/enterprise-commercial/);
  assert.match(jurisdictionRoute, /@expadio\/postgres-runtime\/enterprise-commercial/);
  assert.doesNotMatch(rightsRoute, /from ['"]@\/lib\/enterprise-commercial['"]/);
  assert.doesNotMatch(jurisdictionRoute, /from ['"]@\/lib\/enterprise-commercial['"]/);
});

test('migration backfills only provable current enterprise relationships', () => {
  assert.match(migration, /child\.status NOT IN \('SUSPENDED','CLOSED'\)/);
  assert.match(migration, /binding\.binding_role = 'OPERATED_BY'/);
  assert.match(migration, /legal_entity\.status = 'VERIFIED'/);
  assert.match(migration, /activation\.state = 'ACTIVE'/);
  assert.match(migration, /territory\.status = 'ACTIVE'/);
});
