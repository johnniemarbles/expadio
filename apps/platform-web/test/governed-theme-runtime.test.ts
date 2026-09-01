import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Platform shell resolves only the governed Platform master theme',()=>{
  const runtime=read('../lib/effective-theme.ts');
  const layout=read('../app/(shell)/layout.tsx');
  const shell=read('../components/ShellFrame/ShellFrame.tsx');
  assert.match(runtime,/resolveGovernedTheme\(service,values,\{\}\)/);
  assert.doesNotMatch(runtime,/tenantId:|brandId:|workspaceId:/);
  assert.match(layout,/compileScopedThemeCss/);
  assert.match(layout,/data-expadio-effective-theme="platform"/);
  assert.match(shell,/data-expadio-theme="platform"/);
});

test('theme persistence separates complete profiles from bounded Brand patches',()=>{
  const migration=read('../../../infra/db/migrations/0104_governed_theme_configuration.sql');
  assert.match(migration,/appearance\.theme\.profile/);
  assert.match(migration,/appearance\.theme\.override/);
  assert.match(migration,/ARRAY\['PLAN','VERTICAL'\]/);
  assert.match(migration,/ARRAY\['TENANT','BRAND','WORKSPACE'\]/);
});
