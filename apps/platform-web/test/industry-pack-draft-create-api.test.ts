import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(
  new URL('../app/api/configuration/industry-packs/drafts/route.ts', import.meta.url),
  'utf8',
);

test('Industry Pack draft creation is a tenant-scoped POST boundary', () => {
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /withTenantTransaction\(context/);
  assert.match(route, /scope: \{ type: 'TENANT', tenantId: context\.tenantId \}/);
  assert.doesNotMatch(route, /scope: \{ type: 'PLATFORM'/);
  assert.match(route, /createdBySubjectId: context\.subjectId/);
});

test('Industry Pack draft creation validates untrusted definitions before persistence', () => {
  const validationIndex = route.indexOf('validateIndustryPackDefinition');
  const transactionIndex = route.indexOf('withTenantTransaction(context');
  assert.ok(validationIndex >= 0);
  assert.ok(transactionIndex > validationIndex);
  assert.match(route, /validateIndustryPackDefinition\(body\.definition, verticalKey\)/);
  assert.match(route, /Industry Pack definition is invalid/);
  assert.match(route, /issues: validation\.issues/);
});

test('Industry Pack draft parent lineage is constrained to the same vertical family', () => {
  assert.match(route, /parentVersion must be a positive integer/);
  assert.match(route, /parent: \{ verticalKey, version: Number\(parentVersion\) \}/);
  assert.doesNotMatch(route, /body\.parent\.verticalKey/);
});
