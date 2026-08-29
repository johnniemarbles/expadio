import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(
  new URL('../app/api/configuration/industry-packs/drafts/[verticalKey]/[version]/route.ts', import.meta.url),
  'utf8',
);

test('Industry Pack draft update is an optimistic-concurrency PATCH boundary', () => {
  assert.match(route, /export async function PATCH/);
  assert.doesNotMatch(route, /export async function POST/);
  assert.match(route, /expectedRevision must be a positive integer/);
  assert.match(route, /expectedRevision: Number\(expectedRevision\)/);
  assert.match(route, /INDUSTRY_PACK_DRAFT_UPDATE_CONFLICT/);
  assert.match(route, /status: 409/);
});

test('Industry Pack draft update derives tenant and actor from verified context', () => {
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /withTenantTransaction\(context/);
  assert.match(route, /scope: \{ type: 'TENANT', tenantId: context\.tenantId \}/);
  assert.match(route, /updatedBySubjectId: context\.subjectId/);
  assert.doesNotMatch(route, /scope: \{ type: 'PLATFORM'/);
});

test('Industry Pack draft update validates definition before persistence', () => {
  const validationIndex = route.indexOf('validateIndustryPackDefinition');
  const transactionIndex = route.indexOf('withTenantTransaction(context');
  assert.ok(validationIndex >= 0);
  assert.ok(transactionIndex > validationIndex);
  assert.match(route, /validateIndustryPackDefinition\(body\.definition, verticalKey\)/);
  assert.match(route, /issues: validation\.issues/);
});
