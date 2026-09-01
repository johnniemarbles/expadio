import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');

test('Brand starts generated Next standalone output without running migrations',()=>{
  const pkg=JSON.parse(read('../package.json'));
  assert.equal(pkg.scripts.start,'node scripts/start-standalone.mjs');
  assert.doesNotMatch(pkg.scripts.start,/next start|migrate|seed/);
});

test('Brand standalone launcher copies static assets before start',()=>{
  const launcher=read('../scripts/start-standalone.mjs');
  assert.match(launcher,/server\.js/);
  assert.match(launcher,/cp\(sourceStatic, targetStatic/);
  assert.match(launcher,/0\.0\.0\.0/);
});


test('Brand launcher supports Next monorepo standalone layout',()=>{
  const launcher=read('../scripts/start-standalone.mjs');
  assert.match(launcher,/join\(standaloneRoot, 'apps', appName, 'server\.js'\)/);
  assert.match(launcher,/const runtimeRoot = dirname\(serverPath\)/);
});


test('Brand never inherits the container hostname for the listening socket',()=>{
  const launcher=read('../scripts/start-standalone.mjs');
  assert.match(launcher,/Binding Next\.js to 0\.0\.0\.0/);
  assert.match(launcher,/HOSTNAME: '0\.0\.0\.0'/);
  assert.doesNotMatch(launcher,/process\.env\.HOSTNAME \|\|/);
});
