import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const shell = read('../components/ShellFrame/ShellFrame.tsx');
const route = read('../app/api/workspaces/route.ts');
const styles = read('../app/(shell)/layout.module.css');

test('Platform shell renders navigation from grouped workspace metadata', () => {
  assert.match(shell, /const GROUP_ORDER = new Map/);
  assert.match(shell, /const navGroups = useMemo/);
  assert.match(shell, /section\.group \?\? "Workspace"/);
  assert.match(shell, /navGroups\.map\(\(\{ group, items \}\)/);
  assert.match(shell, /<section className=\{styles\.navGroup\} key=\{group\} aria-label=\{group\}>/);
  assert.match(shell, /<p className=\{styles\.navLabel\}>\{group\}<\/p>/);
  assert.match(shell, /styles\.navGroupItems/);
});

test('Platform shell keeps secondary navigation visually subordinate', () => {
  assert.match(shell, /section\.priority === "secondary" \? styles\.navItemSecondary : ""/);
  assert.match(styles, /\.navItemSecondary \{/);
  assert.match(styles, /\.navItemSecondary \.navIcon/);
  assert.match(route, /priority: 'secondary'/);
});

test('Platform shell exposes control-plane destinations without nested oversight clutter', () => {
  assert.match(route, /href: '\/authority'/);
  assert.match(route, /href: '\/governance'/);
  for (const href of [
    "href: '/governance/analytics'",
    "href: '/governance/decisions'",
    "href: '/governance/workflows'",
    "href: '/governance/pending'",
    "href: '/governance/queue'",
  ]) {
    assert.doesNotMatch(route, new RegExp(href.replaceAll('/', '\\/')));
  }
  assert.match(route, /group: 'Governance'/);
});
test('Platform shell keeps deepest route active before broader parent routes', () => {
  assert.match(shell, /sort\(\(a, b\) => sectionDepth\(b\) - sectionDepth\(a\)\)/);
  assert.match(shell, /matchesSection\(pathname, item\)/);
  assert.match(route, /href: '\/agents'/);
  assert.doesNotMatch(route, /href: '\/agents\/bindings'/);
  assert.match(route, /href: '\/workflows'/);
  assert.doesNotMatch(route, /href: '\/workflows\/blueprints'/);
});
