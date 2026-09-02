import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const route = read('../app/api/enterprise/commercial/portfolio/route.ts');
const hub = read('../app/(shell)/enterprise/EnterpriseHub.tsx');
const projector = read('../../../infra/db/migrations/0118_entity_perspective_projection.sql');
const canonical = read('../../../infra/db/migrations/0118_entity_relationship_perspective_projection.sql');

test('Enterprise Hub exposes all five canonical relationship perspectives', () => {
  for (const perspective of [
    'GOVERNANCE',
    'OWNERSHIP_LEGAL',
    'COMMERCIAL',
    'TERRITORY_JURISDICTION',
    'OPERATIONAL',
  ]) {
    assert.match(route, new RegExp(`'${perspective}'`));
    assert.match(hub, new RegExp(`'${perspective}'`));
  }
  assert.doesNotMatch(route, /'TERRITORY'::text/);
});

test('perspective reads are rooted at the authorized governing organization', () => {
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /context\.organizationId/);
  assert.match(
    route,
    /project_entity_perspective\([\s\S]*\$1::uuid,[\s\S]*'OPERATING_UNIT',[\s\S]*\$2::text/,
  );
  assert.match(route, /\[context\.tenantId, context\.organizationId\]/);
  assert.doesNotMatch(route, /searchParams.*root|rootEntityId|root_entity_id/i);
});

test('portfolio uses the governed recursive projection and shortest explainable path', () => {
  assert.match(route, /platform\.project_entity_perspective/);
  assert.match(route, /jsonb_array_length\(projection\.edge_path\) AS path_depth/);
  assert.match(route, /DISTINCT ON \([\s\S]*projected\.perspective,[\s\S]*projected\.entity_type,[\s\S]*projected\.entity_id/);
  assert.match(route, /projected\.path_depth ASC/);
  assert.match(projector, /WITH RECURSIVE walk/);
  assert.match(projector, /w\.depth < 32/);
});

test('perspective results resolve registry display names without bypassing tenant scope', () => {
  assert.match(route, /LEFT JOIN platform\.entity_registry_nodes node/);
  assert.match(route, /node\.tenant_id = \$1::uuid/);
  assert.match(route, /node\.node_type = projected\.entity_type/);
  assert.match(route, /node\.entity_key = projected\.entity_id/);
});

test('Enterprise Hub perspective view is read-only and explains fail-closed legacy behavior', () => {
  assert.match(hub, /Five-perspective graph/);
  assert.match(hub, /Read-only, effective-dated views rooted at the currently authorized governing organization/);
  assert.match(hub, /Unclassified legacy relationships are excluded/);
  assert.match(canonical, /NULL means legacy\/unclassified and is excluded from perspective projections/);
  assert.doesNotMatch(
    hub,
    /perspective.*mutate\(|create.*perspective|delete.*perspective/i,
  );
});
