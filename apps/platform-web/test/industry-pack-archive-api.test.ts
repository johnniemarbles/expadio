import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(
  new URL('../app/api/configuration/industry-packs/versions/[verticalKey]/[version]/archive/route.ts', import.meta.url),
  'utf8',
);

test('Industry Pack archive route requires governance authorization before repository access', () => {
  const transactionIndex = route.indexOf('withTenantTransaction(context');
  const authzIndex = route.indexOf('hasGovernanceWriteRole(client, context.subjectId)', transactionIndex);
  const repositoryIndex = route.indexOf('PostgresIndustryPackVersionRepository(client)', transactionIndex);
  assert.ok(transactionIndex >= 0);
  assert.ok(authzIndex > transactionIndex);
  assert.ok(repositoryIndex > authzIndex);
  assert.match(route, /reasonKey: 'FORBIDDEN'/);
});

test('Industry Pack archive route uses the lifecycle engine and current state as optimistic guard', () => {
  assert.match(route, /to: 'ARCHIVED'/);
  assert.match(route, /expectedState: current\.state/);
  assert.match(route, /current\.state === 'ARCHIVED'/);
  assert.match(route, /INDUSTRY_PACK_LIFECYCLE_TRANSITION_CONFLICT/);
});

test('Industry Pack archive route is tenant scoped and does not alter runtime binding', () => {
  assert.match(route, /scope = \{ type: 'TENANT' as const, tenantId: context\.tenantId \}/);
  assert.doesNotMatch(route, /scope: \{ type: 'PLATFORM'/);
  assert.doesNotMatch(route, /bindingRepository|tenant_industry_pack_bindings|bindIndustryPack/i);
});
