import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('commercial module entitlement is Platform-owned, not tenant-governance owned', () => {
  const authz = read('../lib/governance-authz.ts');
  const route = read('../app/api/platform/tenant/modules/[key]/entitlements/route.ts');
  assert.match(authz, /hasPlatformAdministrationRole/);
  assert.match(authz, /ownership_scope = 'PLATFORM'/);
  assert.match(authz, /PLATFORM_SUPER_ADMIN/);
  assert.match(authz, /PLATFORM_ADMIN/);
  assert.doesNotMatch(route, /hasGovernanceWriteRole/);
});

test('Platform module screen exposes entitlement manager while Brand remains unable to mint access', () => {
  const page = read('../app/(shell)/modules/page.tsx');
  const manager = read('../components/EntitlementManager/EntitlementManager.tsx');
  const brand = read('../../brand-web/app/(workspace)/page.tsx');
  assert.match(page, /EntitlementManager/);
  assert.match(manager, /PLAN.*ADD_ON.*TRIAL.*CONTRACT.*PLATFORM_GRANT/s);
  assert.doesNotMatch(brand, /grantTenantModuleEntitlement|tenant_module_entitlements.*INSERT/s);
});

test('entitlement mutations append immutable domain-event evidence', () => {
  const runtime = read('../../../packages/postgres-runtime/src/product-module.ts');
  assert.match(runtime, /tenant\.module\.entitlement\.granted/);
  assert.match(runtime, /tenant\.module\.entitlement\.revoked/);
  assert.match(runtime, /appendDomainEventWithOutbox/);
});
