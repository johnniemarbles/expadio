import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const route = read('../app/api/dentex/treatments/[id]/provider/route.ts');
const workspace = read('../app/(shell)/dentex/treatments/[id]/TreatmentWorkspaceClient.tsx');

test('DENTEX Provider assignment keeps Relationship Fabric authoritative', () => {
  assert.match(route, /withTenantTransaction/);
  assert.match(route, /PostgresIndustryPackRuntimeResolver/);
  assert.match(route, /resolveRelationshipDefinitions/);
  assert.match(route, /PostgresEntityRelationshipRepository/);
  assert.match(route, /replaceSingle/);
  assert.match(route, /relationshipKey|definition: providerDefinition/);
  assert.match(route, /participantKey: 'provider'/);
  assert.match(route, /targetKey: provider\.target\.entityId/);
});

test('Treatment workspace uses the governed DENTEX Provider route for provider slots', () => {
  assert.match(workspace, /participantKey === 'provider'/);
  assert.match(workspace, /\$\{treatmentUrl\}\/provider/);
  assert.match(workspace, /Assign me as Provider/);
});
