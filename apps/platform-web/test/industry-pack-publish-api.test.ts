import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(
  new URL('../app/api/configuration/industry-packs/reviews/[verticalKey]/[version]/publish/route.ts', import.meta.url),
  'utf8',
);

test('Industry Pack publication requires governance authorization before repository access', () => {
  const transactionIndex = route.indexOf('withTenantTransaction(context');
  const authzIndex = route.indexOf('hasGovernanceWriteRole(client, context.subjectId)', transactionIndex);
  const repositoryIndex = route.indexOf('PostgresIndustryPackVersionRepository(client)', transactionIndex);
  assert.ok(transactionIndex >= 0);
  assert.ok(authzIndex > transactionIndex);
  assert.ok(repositoryIndex > authzIndex);
  assert.match(route, /reasonKey: 'FORBIDDEN'/);
});

test('Industry Pack publication enforces review state, provenance, and maker checker separation', () => {
  assert.match(route, /current\.state !== 'IN_REVIEW'/);
  assert.match(route, /current\.submittedBySubjectId === undefined/);
  assert.match(route, /current\.submittedBySubjectId === context\.subjectId/);
  assert.match(route, /reasonKey: 'SEPARATION_OF_DUTIES'/);
  assert.match(route, /INDUSTRY_PACK_REVIEW_PROVENANCE_MISSING/);
});

test('Industry Pack publication revalidates persisted definition before lifecycle mutation', () => {
  const validationIndex = route.indexOf('validateIndustryPackDefinition(current.definition, verticalKey)');
  const listIndex = route.indexOf('repository.listVersions');
  assert.ok(validationIndex >= 0);
  assert.ok(listIndex > validationIndex);
  assert.match(route, /INDUSTRY_PACK_DEFINITION_INVALID/);
});

test('Industry Pack publication atomically supersedes existing published version before publishing target', () => {
  assert.match(route, /candidate\.state === 'PUBLISHED'/);
  const supersedeIndex = route.indexOf("to: 'SUPERSEDED'");
  const publishIndex = route.indexOf("to: 'PUBLISHED'");
  assert.ok(supersedeIndex >= 0);
  assert.ok(publishIndex > supersedeIndex);
  assert.match(route, /expectedState: 'PUBLISHED'/);
  assert.match(route, /expectedState: 'IN_REVIEW'/);
  assert.match(route, /scope = \{ type: 'TENANT' as const, tenantId: context\.tenantId \}/);
  assert.doesNotMatch(route, /bind|bindingRepository|tenant_industry_pack_bindings/i);
});
