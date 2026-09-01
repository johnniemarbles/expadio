import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const page = read('../app/(shell)/appearance/page.tsx');
const manager = read('../app/(shell)/appearance/PlatformAppearanceManager.tsx');
const route = read('../app/api/platform/appearance/route.ts');
const migration = read('../../../infra/db/migrations/0105_platform_theme_publication_rls.sql');

test('Platform Appearance publishes only approved complete presets or restored versions', () => {
  assert.match(manager, /Object\.values\(EXPADIO_THEME_PRESETS\)/);
  assert.match(manager, /Publish selected preset/);
  assert.match(manager, /Restore as new version/);
  assert.match(route, /preset\(body\.presetKey\)/);
  assert.match(route, /listPlatformThemeProfiles<unknown>\(client,100\)/);
  assert.match(route, /isExpadioThemeDefinition\(target\.value\)/);
  assert.doesNotMatch(route, /body\.theme|body\.css|dangerouslySetInnerHTML/);
});

test('Platform Appearance is role gated before opening the global RLS insert path', () => {
  const authzIndex = route.indexOf('hasPlatformAdministrationRole(client,context.subjectId)');
  const platformFlagIndex = route.indexOf("set_config('app.platform_admin','true',true)");
  const appendIndex = route.indexOf('appendPlatformThemeProfile(client');
  assert.ok(authzIndex > -1, 'missing Platform administration gate');
  assert.ok(platformFlagIndex > authzIndex, 'admin RLS flag must be set only after authorization');
  assert.ok(appendIndex > platformFlagIndex, 'Platform insert helper must run only after the trusted RLS flag');
  assert.match(route, /PLATFORM_ADMIN_REQUIRED/);
  assert.doesNotMatch(route, /appendTenantThemeOverride/);
});

test('Platform profile insert policy is global but still control-plane bounded', () => {
  assert.match(migration, /DROP POLICY IF EXISTS configuration_setting_values_insert/);
  assert.match(migration, /current_setting\('app\.platform_admin', true\)/);
  assert.match(migration, /setting_key = 'appearance\.theme\.profile'/);
  assert.match(migration, /scope_id IS NULL/);
  assert.match(migration, /tenant_id IS NULL/);
  assert.match(migration, /level = 'PLATFORM'/);
  assert.match(migration, /tenant_id = platform\.current_tenant_id\(\)/);
  assert.match(migration, /level IN \('TENANT', 'BRAND', 'WORKSPACE', 'USER_PREFERENCE', 'OPERATIONAL'\)/);
});

test('Platform Appearance page exposes effective source and immutable history', () => {
  assert.match(page, /loadPlatformEffectiveTheme/);
  assert.match(page, /listPlatformThemeProfiles<unknown>\(client,20\)/);
  assert.match(page, /hasPlatformAdministrationRole/);
  assert.match(manager, /Effective source/);
  assert.match(manager, /Version history/);
  assert.match(manager, /Publication appends a new immutable Platform profile/);
});
