import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('Platform sidebar does not offer the Brand read-model lab', () => {
  const shell = readFileSync(new URL('../components/ShellFrame/ShellFrame.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(shell, /Brand workspace|\/tenant/);
});
test('superseded brand HTML is not shipped as product evidence', () => {
  assert.equal(existsSync(new URL('../../../artifacts/expadio-brand-dashboard.html', import.meta.url)), false);
});
test('tenant route is labeled as a draft read-model lab, not the completed Brand app', () => {
  const workspace = readFileSync(new URL('../app/tenant/workspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /Draft read-model lab/);
  assert.match(workspace, /Not the Brand product/);
});
test('Brand product package is separate from Platform chrome', () => {
  assert.equal(existsSync(new URL('../../../apps/brand-web/src/index.ts', import.meta.url)), true);
  const shell = readFileSync(new URL('../components/ShellFrame/ShellFrame.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(shell, /brand-web|@expadio\/brand-web/);
});
