import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
const route=read('../app/api/appearance/route.ts');
const page=read('../app/(workspace)/appearance/page.tsx');
const manager=read('../app/(workspace)/appearance/BrandAppearanceManager.tsx');
const context=read('../lib/brand-context.ts');

test('Brand Appearance is tenant-scoped, role-gated and policy-bounded',()=>{
  assert.match(page,/withBrandTransaction\(context/);
  assert.match(page,/listTenantThemeOverrides<unknown>\(client,context\.tenantId/);
  assert.match(route,/hasBrandAdministrationRole/);
  assert.match(route,/isThemeOverride/);
  assert.match(route,/validateThemeOverrideAgainstPolicy/);
  assert.match(route,/appendTenantThemeOverride/);
  assert.match(route,/tenantId:context\.tenantId/);
  assert.match(context,/TENANT_OWNER/);
  assert.match(context,/TENANT_ADMIN/);
});

test('Brand rollback and reset append new versions rather than mutating history',()=>{
  assert.match(route,/listTenantThemeOverrides<unknown>\(client,context\.tenantId,100\)/);
  assert.match(route,/appearance:brand-rollback/);
  assert.match(manager,/rollbackRecordVersion:item\.recordVersion/);
  assert.match(manager,/Restore as new version/);
  assert.match(manager,/override:\{\}/);
  assert.match(manager,/Reset overrides/);
  assert.doesNotMatch(route,/UPDATE platform\.configuration_setting_values|DELETE FROM platform\.configuration_setting_values/);
});

test('Brand manager accepts governed tokens only, never arbitrary CSS or script',()=>{
  assert.match(manager,/type="color"/);
  assert.match(manager,/type="url"/);
  assert.match(manager,/Locked by Platform/);
  assert.doesNotMatch(manager,/textarea|contentEditable|dangerouslySetInnerHTML/);
  assert.doesNotMatch(route,/body\.css|body\.javascript|eval\(/);
});
