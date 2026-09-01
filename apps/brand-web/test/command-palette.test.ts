import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('../components/BrandShellFrame.tsx',import.meta.url),'utf8');

test('Brand command palette derives app commands from resolved module descriptors',()=>{
  assert.match(source,/CommandPalette/);
  assert.match(source,/\.\.\.ordered\.map\(\(module\)=>/);
  assert.match(source,/href:module\.baseRoute/);
  assert.match(source,/label:module\.name/);
  assert.match(source,/group:'Apps'/);
  assert.doesNotMatch(source,/label:'Learning'|label:'LMS'|label:'Social'/);
});
