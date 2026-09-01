import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Brand personal appearance API uses the exact active Brand tenant and subject',()=>{
  const route=read('../app/api/appearance/mode/route.ts');
  assert.match(route,/resolveBrandContext/);
  assert.match(route,/withBrandTransaction/);
  assert.match(route,/loadPersonalAppearanceMode\(client,context\.tenantId,context\.subjectId\)/);
  assert.match(route,/persistPersonalAppearanceMode/);
  assert.match(route,/tenantId:context\.tenantId/);
  assert.match(route,/subjectId:context\.subjectId/);
  assert.match(route,/isPersonalAppearanceMode/);
});

test('personal mode remains independent from Brand governed theme overrides',()=>{
  const route=read('../app/api/appearance/mode/route.ts');
  assert.doesNotMatch(route,/appendTenantThemeOverride|validateThemeOverrideAgainstPolicy|primary|secondary|accent/);
});
