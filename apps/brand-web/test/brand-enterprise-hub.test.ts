import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Brand dashboard exposes enterprise as a system capability, not a product module', () => {
  const home = read('../app/(workspace)/page.tsx');
  const shell = read('../components/BrandShellFrame.tsx');
  assert.match(home, /loadBrandEnterpriseView/);
  assert.match(home, /Enterprise control plane/);
  assert.match(home, /Open Enterprise Hub/);
  assert.match(shell, /href="\/enterprise"/);
  assert.match(shell, />Enterprise<\/Link>/);
  assert.doesNotMatch(home, /moduleKey:\s*['"]enterprise['"]/);
  assert.doesNotMatch(shell, /modules.*Enterprise/);
});

test('Brand enterprise visibility is scoped to selected organization hierarchy', () => {
  const data = read('../lib/enterprise-data.ts');
  assert.match(data, /platform\.organization_closure/);
  assert.match(data, /closure\.ancestor_organization_id = \$2::uuid/);
  assert.match(data, /closure\.descendant_organization_id/);
  assert.match(data, /binding\.organization_id = ANY\(\$3::uuid\[\]\)/);
  assert.match(data, /appointment\.grantor_organization_id = ANY\(\$3::uuid\[\]\)/);
  assert.match(data, /activation\.organization_id = ANY\(\$3::uuid\[\]\)/);
  assert.doesNotMatch(data, /WHERE organization\.tenant_id = \$1::uuid\s+ORDER BY/);
});

test('Brand Enterprise Hub renders merged control-plane and commercial domains', () => {
  const page = read('../app/(workspace)/enterprise/page.tsx');
  assert.match(page, /Organization hierarchy &amp; setup readiness/);
  assert.match(page, /Legal entities/);
  assert.match(page, /Agreements &amp; appointments/);
  assert.match(page, /Jurisdiction activations/);
  assert.match(page, /BrandActivateOrganizationButton/);
});

test('Brand descendant activation uses organization-scoped authority and ancestry proof', () => {
  const context = read('../lib/brand-context.ts');
  const route = read('../app/api/enterprise/setup/plans/[planId]/activate/route.ts');
  assert.match(context, /hasBrandGovernanceForOrganization/);
  assert.match(context, /assignment\.organization_id IS NULL/);
  assert.match(context, /action_organization_ids IS NULL/);
  assert.match(route, /hasBrandGovernanceForOrganization/);
  assert.match(route, /platform\.organization_closure/);
  assert.match(route, /closure\.depth > 0/);
  assert.match(route, /activateOrganizationSetup/);
  assert.match(route, /idempotency-key/);
});

test('Brand Enterprise Hub preserves tenant entitlement separation', () => {
  const page = read('../app/(workspace)/enterprise/page.tsx');
  const home = read('../app/(workspace)/page.tsx');
  assert.match(page, /Tenant plan\s+entitlements remain separate/);
  assert.match(home, /listTenantProductModules/);
  assert.match(home, /loadBrandEnterpriseView/);
  assert.doesNotMatch(page, /tenant_module_entitlements/);
});
