import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route=readFileSync(new URL('../app/api/appearance/mode/route.ts',import.meta.url),'utf8');
const control=readFileSync(new URL('../../../packages/ui/src/components/ThemeModeControl.tsx',import.meta.url),'utf8');
const runtime=readFileSync(new URL('../../../packages/postgres-runtime/src/personal-appearance.ts',import.meta.url),'utf8');

test('Brand personal appearance mode uses the active Brand tenant and signed-in subject',()=>{
  assert.match(route,/resolveBrandContext\(\)/);
  assert.match(route,/withBrandTransaction\(context/);
  assert.match(route,/loadPersonalAppearanceMode\(client,context\.tenantId,context\.subjectId\)/);
  assert.match(route,/persistPersonalAppearanceMode/);
  assert.match(route,/tenantId:context\.tenantId/);
  assert.match(route,/subjectId:context\.subjectId/);
  assert.doesNotMatch(route,/hasBrandAdministrationRole|appendTenantThemeOverride|validateThemeOverrideAgainstPolicy/);
});

test('Brand user preference cannot recolor the Brand governed theme',()=>{
  assert.match(control,/document\.documentElement\.dataset\.theme=next/);
  assert.match(control,/body:JSON\.stringify\(\{mode:next\}\)/);
  assert.match(runtime,/appearance\.theme\.mode/);
  assert.doesNotMatch([route,runtime,control].join('\n'),/ThemeOverride|primary|secondary|accent|logoUrl|brandName|body\.css|body\.javascript|dangerouslySetInnerHTML|eval\(/);
});
