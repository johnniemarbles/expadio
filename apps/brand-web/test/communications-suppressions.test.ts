import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const collection = readFileSync(new URL('../app/api/communications/suppressions/route.ts', import.meta.url), 'utf8');
const item = readFileSync(new URL('../app/api/communications/suppressions/[suppressionId]/route.ts', import.meta.url), 'utf8');

test('Brand suppression management is organization scoped and governance gated', () => {
  assert.match(collection, /organization_id = \$2::uuid/);
  assert.match(collection, /organizationId: context\.organizationId/);
  assert.match(collection, /hasBrandGovernanceForOrganization/);
  assert.match(item, /organization_id = \$3::uuid/);
  assert.match(item, /hasBrandGovernanceForOrganization/);
});

test('Brand can revoke only active suppressions owned by the selected organization', () => {
  assert.match(item, /suppression_id = \$1::uuid/);
  assert.match(item, /tenant_id = \$2::uuid/);
  assert.match(item, /organization_id = \$3::uuid/);
  assert.match(item, /status = 'ACTIVE'/);
  assert.match(item, /repository\.revoke/);
});

test('Brand suppression APIs cannot create or revoke tenant-global suppression state', () => {
  assert.doesNotMatch(collection, /organizationId\s*\?\s*context/);
  assert.doesNotMatch(collection, /organization_id IS NULL/);
  assert.doesNotMatch(item, /organization_id IS NULL/);
  assert.doesNotMatch(collection + item, /DELETE FROM platform\.communication_suppressions/);
});
