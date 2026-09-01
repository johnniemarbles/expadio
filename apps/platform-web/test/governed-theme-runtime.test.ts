import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Platform shell resolves only the governed Platform master theme',()=>{
  const runtime=read('../lib/effective-theme.ts');
  const layout=read('../app/(shell)/layout.tsx');
  const shell=read('../components/ShellFrame/ShellFrame.tsx');
  assert.match(runtime,/resolveGovernedTheme\(service,\{\}\)/);
  assert.doesNotMatch(runtime,/tenantId:|brandId:/);
  assert.match(layout,/compileScopedThemeCss/);
  assert.match(layout,/data-expadio-effective-theme="platform"/);
  assert.match(shell,/data-expadio-theme="platform"/);
});
