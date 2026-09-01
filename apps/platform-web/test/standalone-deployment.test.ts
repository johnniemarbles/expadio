import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');

test('Platform starts Next standalone output after migrations and bootstrap seed',()=>{
  const pkg=JSON.parse(read('../package.json'));
  assert.match(pkg.scripts.start,/scripts\/migrate\.mjs/);
  assert.match(pkg.scripts.start,/scripts\/seed\.cjs/);
  assert.match(pkg.scripts.start,/scripts\/start-standalone\.mjs/);
  assert.doesNotMatch(pkg.scripts.start,/next start/);
});

test('standalone launcher copies static assets and binds Railway-compatible hostname',()=>{
  const launcher=read('../scripts/start-standalone.mjs');
  assert.match(launcher,/\.next', 'standalone'/);
  assert.match(launcher,/sourceStatic/);
  assert.match(launcher,/cp\(sourceStatic, targetStatic/);
  assert.match(launcher,/HOSTNAME: process\.env\.HOSTNAME \|\| '0\.0\.0\.0'/);
});


test('Platform launcher supports Next monorepo standalone layout',()=>{
  const launcher=read('../scripts/start-standalone.mjs');
  assert.match(launcher,/join\(standaloneRoot, 'apps', appName, 'server\.js'\)/);
  assert.match(launcher,/const runtimeRoot = dirname\(serverPath\)/);
  assert.match(launcher,/const targetStatic = join\(runtimeRoot, '\.next', 'static'\)/);
});
