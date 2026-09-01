import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('../components/ShellFrame/ShellFrame.tsx',import.meta.url),'utf8');

test('Platform command palette derives commands from live workspace sections',()=>{
  assert.match(source,/CommandPalette/);
  assert.match(source,/items=\{sections\.map/);
  assert.match(source,/href:href\(section\.href\)/);
  assert.match(source,/label:section\.label/);
  assert.doesNotMatch(source,/placeholder="Search fleet &amp; connectors/);
  assert.doesNotMatch(source,/readOnly/);
});
