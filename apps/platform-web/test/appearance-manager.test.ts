import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
const route=read('../app/api/platform/appearance/route.ts');
const page=read('../app/(shell)/appearance/page.tsx');
const manager=read('../app/(shell)/appearance/PlatformAppearanceManager.tsx');
const runtime=read('../../../packages/postgres-runtime/src/theme-configuration.ts');
const migration=read('../../../infra/db/migrations/0105_platform_theme_publication_rls.sql');

test('Platform Appearance Manager publishes only approved immutable profiles',()=>{
  assert.match(page,/hasPlatformAdministrationRole/);
  assert.match(route,/hasPlatformAdministrationRole/);
  assert.match(route,/EXPADIO_THEME_PRESETS/);
  assert.match(route,/listPlatformThemeProfiles/);
  assert.match(route,/isExpadioThemeDefinition/);
  assert.match(route,/appendPlatformThemeProfile/);
  assert.doesNotMatch(route,/body\.theme|body\.css|body\.javascript|eval\(/);
  assert.match(manager,/Restore as new version/);
  assert.match(manager,/Publish selected preset/);
});

test('Platform publication opens the forced-RLS control-plane path only after authorization',()=>{
  const authz=route.indexOf('hasPlatformAdministrationRole');
  const elevate=route.indexOf("set_config('app.platform_admin'");
  const publish=route.lastIndexOf('appendPlatformThemeProfile');
  assert.ok(authz>=0&&elevate>authz&&publish>elevate);
  assert.match(migration,/setting_key = 'appearance\.theme\.profile'/);
  assert.match(migration,/level = 'PLATFORM'/);
  assert.match(migration,/current_setting\('app\.platform_admin', true\)/);
  assert.match(migration,/tenant_id = platform\.current_tenant_id\(\)/);
  assert.match(migration,/level IN \('TENANT', 'BRAND', 'WORKSPACE', 'USER_PREFERENCE', 'OPERATIONAL'\)/);
});

test('theme publication runtime is append-only and concurrency serialized',()=>{
  assert.match(runtime,/pg_advisory_xact_lock/);
  assert.match(runtime,/COALESCE\(MAX\(record_version\),0\)\+1/);
  assert.match(runtime,/INSERT INTO platform\.configuration_setting_values/);
  assert.doesNotMatch(runtime,/UPDATE platform\.configuration_setting_values/);
  assert.doesNotMatch(runtime,/DELETE FROM platform\.configuration_setting_values/);
});
