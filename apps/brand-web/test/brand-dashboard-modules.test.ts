import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Brand home is a module dashboard rather than a Learning redirect', () => {
  const page = read('../app/(workspace)/page.tsx');
  assert.match(page, /listTenantProductModules/);
  assert.match(page, /<h1>All Apps<\/h1>/);
  assert.doesNotMatch(page, /redirect\('\/learning'\)/);
  assert.doesNotMatch(page, /tenant_module_entitlements.*INSERT|INSERT.*tenant_module_entitlements/s);
});

test('Platform-to-Brand handoff revalidates membership before changing workspace cookies', () => {
  const handoff = read('../app/handoff/route.ts');
  assert.match(handoff, /resolveBrandContext/);
  assert.match(handoff, /context\.workspaces\.some/);
  assert.match(handoff, /BRAND_WORKSPACE_ACCESS_DENIED/);
  assert.match(handoff, /response\.cookies\.set/);
});


test('Brand resolves membership and workspace labels through one RLS-safe bootstrap transaction', () => {
  const context = read('../lib/brand-context.ts');
  assert.match(context, /listActiveMembershipWorkspaces/);
  assert.doesNotMatch(context, /membershipRepository\.listActiveMemberships/);
  assert.doesNotMatch(context, /dbPool\.query<\{tenant_id:string;tenant_name:string/);
});

test('genuinely unavailable Brand access renders a product state, not bootstrap diagnostics', () => {
  const layout = read('../app/(workspace)/layout.tsx');
  assert.match(layout, /BrandContextError/);
  assert.match(layout, /NO_BRAND_MEMBERSHIP/);
  assert.match(layout, /Brand access unavailable/);
  assert.doesNotMatch(layout, /No Brand workspace assigned/);
  assert.doesNotMatch(layout, /intentionally not auto-provisioned/);
});

test('handoff returns an explicit 403 when the caller has no Brand membership', () => {
  const handoff = read('../app/handoff/route.ts');
  assert.match(handoff, /NO_BRAND_MEMBERSHIP/);
  assert.match(handoff, /status: 403/);
});


test('Brand unavailable state is self-diagnosing and supports Clerk session recovery', () => {
  const context = read('../lib/brand-context.ts');
  const layout = read('../app/(workspace)/layout.tsx');
  const recovery = read('../components/BrandAccessRecovery.tsx');
  assert.match(context, /diagnoseBrandAccess/);
  assert.match(context, /NO_MATCHING_MEMBERSHIP/);
  assert.match(context, /MEMBERSHIP_SUSPENDED/);
  assert.match(context, /MEMBERSHIP_REVOKED/);
  assert.match(context, /MEMBERSHIP_EXPIRED/);
  assert.match(layout, /BrandAccessRecovery/);
  assert.match(recovery, /Signed in as/);
  assert.match(recovery, /Sign out & use another account/);
  assert.match(recovery, /Retry access/);
  assert.match(recovery, /Compare the Clerk user ID/);
});


test('Brand Shell v2 derives pinned app navigation from active product-module manifests', () => {
  const layout = read('../app/(workspace)/layout.tsx');
  const shell = read('../components/BrandShellFrame.tsx');
  assert.match(layout, /listTenantProductModules/);
  assert.match(layout, /parseProductModuleShellDescriptor/);
  assert.match(layout, /availability === 'ACTIVE'/);
  assert.match(shell, /defaultPinned/);
  assert.match(shell, /All Apps/);
  assert.doesNotMatch(layout, /const NAV/);
});

test('Learning owns module-local sections instead of expanding the global sidebar', () => {
  const layout = read('../app/(workspace)/learning/layout.tsx');
  const frame = read('../components/ModuleWorkspaceFrame.tsx');
  assert.match(layout, /loadTenantProductModule/);
  assert.match(layout, /parseProductModuleShellDescriptor/);
  assert.match(frame, /placement==='primary'/);
  assert.match(frame, /placement==='more'/);
});

test('Learning manifest contributes navigation metadata without granting entitlement', () => {
  const migration = read('../../../infra/db/migrations/0103_product_module_shell_descriptor.sql');
  assert.match(migration, /UPDATE platform\.product_modules/);
  assert.match(migration, /'shell'/);
  assert.match(migration, /'defaultPinned', true/);
  assert.doesNotMatch(migration, /tenant_module_entitlements.*INSERT|INSERT INTO platform\.tenant_module_entitlements/s);
});
