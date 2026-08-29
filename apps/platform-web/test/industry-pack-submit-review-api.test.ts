import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(
  new URL('../app/api/configuration/industry-packs/drafts/[verticalKey]/[version]/submit/route.ts', import.meta.url),
  'utf8',
);

test('Industry Pack submit route moves only tenant DRAFT versions into review', () => {
  assert.match(route, /export async function POST/);
  assert.match(route, /scope = \{ type: 'TENANT' as const, tenantId: context\.tenantId \}/);
  assert.match(route, /current\.state !== 'DRAFT'/);
  assert.match(route, /to: 'IN_REVIEW'/);
  assert.match(route, /expectedState: 'DRAFT'/);
  assert.match(route, /Only DRAFT Industry Pack versions can be submitted for review/);
});

test('Industry Pack submit route revalidates persisted definition before lifecycle mutation', () => {
  const validationIndex = route.indexOf('validateIndustryPackDefinition(current.definition, verticalKey)');
  const transitionIndex = route.indexOf('transitionIndustryPackVersion');
  assert.ok(validationIndex >= 0);
  assert.ok(transitionIndex >= 0);
  assert.ok(route.lastIndexOf('transitionIndustryPackVersion') > validationIndex);
  assert.match(route, /INDUSTRY_PACK_DEFINITION_INVALID/);
});

test('Industry Pack submit route binds actor and mutation to the verified tenant transaction', () => {
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /withTenantTransaction\(context/);
  assert.match(route, /actorSubjectId: context\.subjectId/);
  assert.match(route, /PostgresIndustryPackVersionRepository/);
});
