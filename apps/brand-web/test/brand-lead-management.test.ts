import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../../../infra/db/migrations/0124_brand_lead_management_module.sql');
const page = read('../app/(workspace)/leads/page.tsx');
const layout = read('../app/(workspace)/leads/layout.tsx');
const leads = read('../lib/brand-leads.ts');

test('Lead Management is a catalogued module whose manifest cannot mint entitlement', () => {
  assert.match(migration, /'lead-management'/);
  assert.match(migration, /'href','\/leads'/);
  assert.doesNotMatch(migration, /INSERT INTO platform\.tenant_module_entitlements/i);
  assert.doesNotMatch(migration, /INSERT INTO platform\.tenant_modules/i);
});

test('Brand Lead route is gated by governed module availability', () => {
  assert.match(page, /loadTenantProductModule/);
  assert.match(page, /moduleKey: 'lead-management'/);
  assert.match(page, /availability !== 'ACTIVE'/);
  assert.match(layout, /parseProductModuleShellDescriptor/);
});

test('Brand Lead mutations require governance for the selected organization', () => {
  assert.match(page, /hasBrandGovernanceForOrganization/);
  assert.match(page, /context\.organizationId/);
  assert.match(page, /LEAD_WRITE_FORBIDDEN/);
});

test('Brand Lead persistence is organization-bound and trusts request context, not form scope', () => {
  assert.match(leads, /tenant_id, organization_id, title, stage/);
  assert.match(leads, /input\.tenantId, input\.organizationId/);
  assert.doesNotMatch(page, /formData\.get\(['"]organizationId['"]\)/);
  assert.doesNotMatch(page, /formData\.get\(['"]captureLayerId['"]\)/);
  assert.doesNotMatch(page, /formData\.get\(['"]captureLeadId['"]\)/);
});

test('Brand customer conversion preserves organization scope and rejects lost leads', () => {
  assert.match(leads, /LOST_LEAD_CANNOT_CONVERT/);
  assert.match(leads, /organization_id = \$2::uuid/);
  assert.match(leads, /crm_accounts \(tenant_id, organization_id, name, lifecycle_stage\)/);
  assert.match(leads, /stage = 'WON'/);
});
