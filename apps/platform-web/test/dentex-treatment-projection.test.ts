import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const route = read('../app/api/dentex/treatments/[id]/route.ts');
const projection = read('../lib/dentex-treatment-projection.ts');

test('DENTEX Treatment workspace API is tenant-scoped and projection-backed', () => {
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /withTenantClient\(context/);
  assert.match(route, /loadDentexTreatmentWorkspace/);
  assert.match(route, /That Treatment was not found in this workspace/);
});

test('Treatment workspace reads provider from Relationship Fabric, not workflow assignment', () => {
  assert.match(projection, /platform\.entity_relationships/);
  assert.match(projection, /relationship_key = 'provider'/);
  assert.doesNotMatch(projection, /workflow_participant_assignments/);
});

test('Treatment workspace composes existing horizontal authorities', () => {
  assert.match(projection, /platform\.crm_cases/);
  assert.match(projection, /platform\.crm_contacts/);
  assert.match(projection, /platform\.crm_accounts/);
  assert.match(projection, /platform\.workflow_instances/);
  assert.match(projection, /platform\.crm_agreements/);
});
