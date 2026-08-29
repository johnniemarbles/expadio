import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(
  new URL('../app/api/configuration/industry-packs/versions/route.ts', import.meta.url),
  'utf8',
);

test('Industry Pack version history route is tenant-context bound and read only', () => {
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function PATCH/);
  assert.doesNotMatch(route, /export async function DELETE/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /withTenantClient\(context/);
  assert.match(route, /PostgresIndustryPackVersionRepository/);
});

test('Industry Pack version history keeps tenant and platform scopes explicit', () => {
  assert.match(route, /scope: \{ type: 'TENANT', tenantId: context\.tenantId \}/);
  assert.match(route, /scope: \{ type: 'PLATFORM' \}/);
  assert.match(route, /tenantVersions/);
  assert.match(route, /platformVersions/);
  assert.match(route, /verticalKey is required/);
});

test('Industry Pack version history returns summaries instead of full definitions', () => {
  assert.match(route, /label: version\.definition\.label/);
  assert.doesNotMatch(route, /definition: version\.definition/);
  assert.match(route, /state: version\.state/);
  assert.match(route, /revision: version\.revision/);
});
