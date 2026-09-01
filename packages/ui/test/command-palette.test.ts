import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');

test('command palette has real keyboard open, navigation and close behavior',()=>{
  const source=read('../src/components/CommandPalette.tsx');
  assert.match(source,/event\.metaKey\|\|event\.ctrlKey/);
  assert.match(source,/key\.toLowerCase\(\)==='k'/);
  assert.match(source,/event\.key==='Escape'/);
  assert.match(source,/event\.key==='ArrowDown'/);
  assert.match(source,/event\.key==='ArrowUp'/);
  assert.match(source,/event\.key==='Enter'/);
  assert.match(source,/window\.location\.assign\(item\.href\)/);
  assert.match(source,/role="dialog"/);
  assert.match(source,/role="listbox"/);
  assert.match(source,/aria-activedescendant/);
});

test('command palette searches supplied commands instead of fabricated results',()=>{
  const source=read('../src/components/CommandPalette.tsx');
  assert.match(source,/items\.filter/);
  assert.match(source,/item\.keywords/);
  assert.doesNotMatch(source,/LMS|Dentex|Social|CRM|Northstar|Urban Realty/);
});
