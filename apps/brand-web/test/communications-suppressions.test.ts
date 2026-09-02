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

test('Brand suppression register supports status filtering and reachable pagination', () => {
  assert.match(collection, /status = url\.searchParams\.get\('status'\)/);
  assert.match(collection, /page = Math\.max/);
  assert.match(collection, /LIMIT \$4 OFFSET \$5/);
  assert.match(collection, /hasMore/);
});

test('Brand can revoke only active suppressions owned by the selected organization', () => {
  assert.match(item, /UUID_RE\.test\(suppressionId\)/);
  assert.match(item, /status: 400/);
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
