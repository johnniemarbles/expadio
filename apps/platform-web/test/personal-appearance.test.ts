import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Platform personal appearance API is authenticated, tenant-bound and mode-only',()=>{
  const route=read('../app/api/appearance/mode/route.ts');
  assert.match(route,/resolveRequestContext/);
  assert.match(route,/withTenantTransaction/);
  assert.match(route,/loadPersonalAppearanceMode\(client,context\.tenantId,context\.subjectId\)/);
  assert.match(route,/persistPersonalAppearanceMode/);
  assert.match(route,/isPersonalAppearanceMode/);
  assert.doesNotMatch(route,/primary|secondary|accent|css|javascript/);
});

test('shared ThemeModeControl durably syncs while preserving the render cookie',()=>{
  const control=read('../../../packages/ui/src/components/ThemeModeControl.tsx');
  assert.match(control,/expadio-theme-mode/);
  assert.match(control,/persistenceUrl='\/api\/appearance\/mode'/);
  assert.match(control,/method:'GET'/);
  assert.match(control,/method:'POST'/);
  assert.match(control,/credentials:'same-origin'/);
  assert.match(control,/JSON\.stringify\(\{mode:next\}\)/);
});
