import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(
  new URL(
    '../app/api/configuration/industry-packs/drafts/[verticalKey]/[version]/route.ts',
    import.meta.url,
  ),
  'utf8',
);

test('Industry Pack draft GET is governance-gated before full definition lookup', () => {
  assert.match(route, /export async function GET/);
  const getIndex = route.indexOf('export async function GET');
  const patchIndex = route.indexOf('export async function PATCH');
  const getSource = route.slice(getIndex, patchIndex);

  const authIndex = getSource.indexOf('await hasGovernanceWriteRole');
  const repositoryIndex = getSource.indexOf('repository.findByIdentity');
  assert.ok(authIndex >= 0);
  assert.ok(repositoryIndex > authIndex);
  assert.match(getSource, /withTenantTransaction\(context/);
  assert.match(getSource, /scope: \{ type: 'TENANT', tenantId: context\.tenantId \}/);
});

test('Industry Pack draft GET returns the full draft only while it remains DRAFT', () => {
  const getIndex = route.indexOf('export async function GET');
  const patchIndex = route.indexOf('export async function PATCH');
  const getSource = route.slice(getIndex, patchIndex);

  assert.match(getSource, /draft\.state !== 'DRAFT'/);
  assert.match(getSource, /INDUSTRY_PACK_DRAFT_REQUIRED/);
  assert.match(getSource, /return NextResponse\.json\(\{ draft: result\.draft \}\)/);
  assert.match(getSource, /Industry Pack draft was not found/);
});
