import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route=readFileSync(new URL('../app/api/appearance/mode/route.ts',import.meta.url),'utf8');
const control=readFileSync(new URL('../../../packages/ui/src/components/ThemeModeControl.tsx',import.meta.url),'utf8');
const runtime=readFileSync(new URL('../../../packages/postgres-runtime/src/personal-appearance.ts',import.meta.url),'utf8');
const migration=readFileSync(new URL('../../../infra/db/migrations/0106_personal_theme_mode.sql',import.meta.url),'utf8');

test('Platform personal appearance mode uses authenticated tenant/user scope',()=>{
  assert.match(route,/resolveRequestContext\(request\)/);
  assert.match(route,/withTenantTransaction\(context/);
  assert.match(route,/loadPersonalAppearanceMode\(client,context\.tenantId,context\.subjectId\)/);
  assert.match(route,/persistPersonalAppearanceMode/);
  assert.match(route,/tenantId:context\.tenantId/);
  assert.match(route,/subjectId:context\.subjectId/);
  assert.doesNotMatch(route,/PLATFORM_ADMIN_REQUIRED|hasPlatformAdministrationRole|set_config\('app\.platform_admin'/);
});

test('personal mode is display preference only and cannot override governed theme tokens',()=>{
  assert.match(migration,/appearance\.theme\.mode/);
  assert.match(migration,/ARRAY\['USER_PREFERENCE'\]/);
  assert.match(migration,/"enum":\["light","dark","system"\]/);
  assert.match(runtime,/level='USER_PREFERENCE'/);
  assert.match(runtime,/scope_id=\$2/);
  assert.match(control,/body:JSON\.stringify\(\{mode:next\}\)/);
  assert.doesNotMatch(route,/body\.(?:primary|secondary|accent|css|javascript|logoUrl|brandName)/);
  assert.doesNotMatch(route,/ThemeOverride|appendTenantThemeOverride|appendPlatformThemeProfile|set_config\('app\.platform_admin'/);
  assert.doesNotMatch(runtime,/appearance\.theme\.override|appearance\.theme\.profile|ThemeOverride/);
  assert.doesNotMatch(control,/dangerouslySetInnerHTML|eval\(/);
});
