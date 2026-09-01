import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const contracts = readFileSync(new URL('../lib/contracts.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/workspaces/route.ts', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../components/ShellFrame/ShellFrame.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../app/(shell)/layout.module.css', import.meta.url), 'utf8');

test('workspace navigation is grouped instead of one flat enterprise list', () => {
  assert.match(contracts, /group\?: string/);
  assert.match(contracts, /priority\?: "primary" \| "secondary"/);
  for (const group of ['Workspace', 'Growth', 'Decision Fabric', 'Agent Intelligence', 'Administration']) {
    assert.match(route, new RegExp(`group: '${group}'`));
  }
  assert.match(shell, /navigationGroups/);
  assert.match(shell, /styles\.navGroup/);
  assert.match(shell, /styles\.navItemSecondary/);
  assert.match(styles, /\.navGroup/);
  assert.match(styles, /\.navItemSecondary/);
});

test('deep routes own active state before broader parent routes', () => {
  assert.match(shell, /sectionDepth\(b\) - sectionDepth\(a\)/);
  assert.match(shell, /matchesSection\(pathname, item\)/);
  assert.match(route, /href: '\/agents\/bindings'/);
  assert.match(route, /href: '\/agents'/);
  assert.match(route, /href: '\/workflows\/blueprints'/);
  assert.match(route, /href: '\/workflows'/);
});

test('platform navigation avoids duplicate ambiguous initials and CRM double naming', () => {
  assert.match(route, /label: 'Organizations'/);
  assert.doesNotMatch(route, /Organizations & CRM/);
  assert.match(route, /label: 'CRM'/);
  assert.match(route, /short: 'AG'/);
  assert.match(route, /short: 'AX'/);
  assert.doesNotMatch(route, /short: 'AR'/);
});
