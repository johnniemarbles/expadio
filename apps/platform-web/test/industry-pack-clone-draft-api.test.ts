import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(
  new URL(
    '../app/api/configuration/industry-packs/drafts/clone-active/route.ts',
    import.meta.url,
  ),
  'utf8',
);

test('clone-active is a governed tenant-scoped POST boundary', () => {
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function GET/);

  const authIndex = route.indexOf('await hasGovernanceWriteRole');
  const tenantReadIndex = route.indexOf('SELECT vertical_key');
  const resolverIndex = route.indexOf('new PostgresIndustryPackRuntimeResolver');
  const draftIndex = route.indexOf('await repository.createDraft');

  assert.ok(authIndex >= 0);
  assert.ok(tenantReadIndex > authIndex);
  assert.ok(resolverIndex > authIndex);
  assert.ok(draftIndex > resolverIndex);
  assert.match(route, /withTenantTransaction\(context/);
  assert.match(route, /scope: \{ type: 'TENANT', tenantId: context\.tenantId \}/);
});

test('clone-active derives the draft from the exact resolved runtime Pack', () => {
  assert.match(route, /verticalKey: resolved\.provenance\.verticalKey/);
  assert.match(route, /definition: resolved\.pack/);
  assert.match(route, /clonedFrom: resolved\.provenance/);
  assert.match(route, /INDUSTRY_PACK_ACTIVE_BINDING_REQUIRED/);
  assert.match(route, /INDUSTRY_PACK_RUNTIME_NOT_FOUND/);
});

test('clone-active only records parent lineage for a tenant-published source', () => {
  assert.match(route, /resolved\.provenance\.source === 'TENANT_PUBLISHED'/);
  assert.match(route, /version: resolved\.provenance\.version/);
  assert.doesNotMatch(route, /PLATFORM_PUBLISHED'[\s\S]*parent:/);
  assert.doesNotMatch(route, /CODE_BASELINE'[\s\S]*parent:/);
});
