import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Platform navigation exposes governed entitlements and Brand handoff', () => {
  const workspaces = read('../app/api/workspaces/route.ts');
  const shell = read('../components/ShellFrame/ShellFrame.tsx');
  assert.match(workspaces, /Apps/);
  assert.match(workspaces, /href: '\/modules'/);
  assert.match(shell, /new URL\('\/handoff'/);
  assert.match(shell, /Open Brand Workspace/);
});

test('Platform module dashboard reads existing module catalog and activation API', () => {
  const page = read('../app/(shell)/modules/page.tsx');
  const action = read('../components/ModuleAction/ModuleAction.tsx');
  assert.match(page, /\/api\/tenant\/modules/);
  assert.match(action, /\/api\/tenant\/modules\/\$\{encodeURIComponent\(moduleKey\)\}\/activate/);
  assert.doesNotMatch(page + action, /INSERT INTO platform\.tenant_module_entitlements/);
});
