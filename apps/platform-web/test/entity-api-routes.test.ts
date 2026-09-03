import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const list = read('../app/api/entities/route.ts');
const detail = read('../app/api/entities/[nodeId]/route.ts');
const dissolve = read('../app/api/entities/[nodeId]/dissolve/route.ts');
const relationships = read('../app/api/entities/[nodeId]/relationships/route.ts');
const terminate = read('../app/api/entities/[nodeId]/relationships/[relationshipId]/terminate/route.ts');
const genesis = read('../app/api/bootstrap/genesis/route.ts');

test('entity writes require step-up and tenant transactions', () => {
  for (const route of [list,dissolve,relationships,terminate]) {
    assert.match(route,/withTenantTransaction/);
  }
  assert.match(list,/requireStepUp/);
  assert.match(dissolve,/requireStepUp/);
  assert.match(relationships,/requireStepUp/);
  assert.match(terminate,/requireStepUp/);
});
test('nodes dissolve and relationships terminate; no DELETE handlers exist', () => {
  assert.match(dissolve,/DISSOLVED/);
  assert.match(terminate,/TERMINATED/);
  for (const route of [list,detail,dissolve,relationships,terminate]) assert.doesNotMatch(route,/export async function DELETE/);
});
test('LEGACY creation is rejected through domain validation and governance approval is enforced', () => {
  assert.match(relationships,/validateCreateRelationship/);
  assert.match(relationships,/APPROVAL_REQUIRED/);
  assert.match(relationships,/BRAND_HQ/);
});
test('genesis is idempotent and maps conflicts', () => {
  assert.match(genesis,/alreadyExisted/);
  assert.match(genesis,/ALREADY_BOOTSTRAPPED/);
  assert.match(genesis,/GENESIS_CLAIMED/);
  assert.match(genesis,/GENESIS_EXPIRED/);
});
