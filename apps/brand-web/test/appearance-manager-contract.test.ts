import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const page = read('../app/(workspace)/appearance/page.tsx');
const manager = read('../app/(workspace)/appearance/BrandAppearanceManager.tsx');
const route = read('../app/api/appearance/route.ts');
const shell = read('../components/BrandShellFrame.tsx');

test('Brand Appearance edits only policy-permitted identity fields', () => {
  assert.match(manager, /policy\.allowPrimary\?\{primary\}:\{\}/);
  assert.match(manager, /policy\.allowSecondary\?\{secondary\}:\{\}/);
  assert.match(manager, /policy\.allowAccent\?\{accent\}:\{\}/);
  assert.match(manager, /policy\.allowAssets\?\{brandName/);
  assert.match(manager, /Typography <b>\{policy\.allowTypography\?'Editable':'Locked by Platform'\}<\/b>/);
  assert.match(manager, /Geometry <b>\{policy\.allowGeometry\?'Editable':'Locked by Platform'\}<\/b>/);
  assert.doesNotMatch(manager, /textarea|customCss|script|innerHTML/);
});

test('Brand Appearance API validates override schema and inherited Platform policy before append', () => {
  const schemaIndex = route.indexOf('isThemeOverride(body.override)');
  const effectiveIndex = route.indexOf('loadBrandEffectiveTheme(client,context)');
  const policyIndex = route.indexOf('validateThemeOverrideAgainstPolicy(effective.theme,override)');
  const appendIndex = route.indexOf('appendTenantThemeOverride(client');
  assert.ok(schemaIndex > -1, 'missing override schema validation');
  assert.ok(effectiveIndex > schemaIndex, 'must load inherited effective theme after schema validation');
  assert.ok(policyIndex > effectiveIndex, 'must validate against inherited Platform policy');
  assert.ok(appendIndex > policyIndex, 'must append only after policy approval');
  assert.match(route, /BRAND_ADMIN_REQUIRED/);
  assert.match(route, /tenantId:context\.tenantId/);
  assert.doesNotMatch(route, /appendPlatformThemeProfile|set_config\('app\.platform_admin'/);
});

test('Brand reset and restore remain append-only publications', () => {
  assert.match(manager, /publish\(\{override:\{\},reason:'Reset Brand appearance to inherited Platform theme'\}\)/);
  assert.match(manager, /Restore as new version/);
  assert.match(route, /rollbackRecordVersion/);
  assert.match(route, /listTenantThemeOverrides<unknown>\(client,context\.tenantId,100\)/);
  assert.match(route, /evidence='appearance:brand-rollback'/);
  assert.doesNotMatch(route, /UPDATE platform\.configuration_setting_values|DELETE FROM platform\.configuration_setting_values/i);
});

test('Brand Appearance is reachable from the Brand shell and shows inherited state', () => {
  assert.match(shell, /href="\/appearance"/);
  assert.match(shell, /Administration/);
  assert.match(page, /loadBrandEffectiveTheme/);
  assert.match(page, /listTenantThemeOverrides<unknown>\(client,context\.tenantId,20\)/);
  assert.match(page, /Effective inherited profile|Apply approved Brand identity/);
  assert.match(manager, /Effective source/);
  assert.match(manager, /Only permitted fields are persisted/);
});
