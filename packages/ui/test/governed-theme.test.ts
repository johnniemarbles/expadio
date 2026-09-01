import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXPADIO_COMMAND_OBSIDIAN,
  compileScopedThemeCss,
  governedThemeOverrideValidator,
  isExpadioThemeDefinition,
  resolveThemeOverride,
} from '../src/index.ts';

function candidate(level:string,value:unknown){
  return {
    level:level as any,
    recordId:level+'-1',
    version:1,
    effectiveFrom:'2026-09-01T00:00:00Z',
    value,
    evidenceRefs:['test'],
  };
}

test('Obsidian preset satisfies governed theme schema and compiles scoped light/dark/system CSS',()=>{
  assert.equal(isExpadioThemeDefinition(EXPADIO_COMMAND_OBSIDIAN),true);
  const css=compileScopedThemeCss(EXPADIO_COMMAND_OBSIDIAN,'brand');
  assert.match(css,/data-expadio-theme="brand"/);
  assert.match(css,/data-theme="dark"/);
  assert.match(css,/data-theme="system"/);
  assert.match(css,/--theme-canvas:#05080d/);
});

test('bounded tenant override allows brand accent but rejects protected canvas mutation',()=>{
  const accent=resolveThemeOverride(EXPADIO_COMMAND_OBSIDIAN,{accent:'#ff3366'});
  assert.equal(governedThemeOverrideValidator({
    current:candidate('PLATFORM',EXPADIO_COMMAND_OBSIDIAN),
    candidate:candidate('TENANT',accent),
  }).allowed,true);

  const illegal={
    ...accent,
    light:{...accent.light,canvas:'#000000'},
  };
  const result=governedThemeOverrideValidator({
    current:candidate('PLATFORM',EXPADIO_COMMAND_OBSIDIAN),
    candidate:candidate('TENANT',illegal),
  });
  assert.equal(result.allowed,false);
  assert.equal(result.code,'THEME_OVERRIDE_OUTSIDE_POLICY');
});

test('vertical profile may change presentation but cannot relax Platform override policy',()=>{
  const vertical={...EXPADIO_COMMAND_OBSIDIAN,key:'clinical-obsidian',light:{...EXPADIO_COMMAND_OBSIDIAN.light,primary:'#0f766e'}};
  assert.equal(governedThemeOverrideValidator({
    current:candidate('PLATFORM',EXPADIO_COMMAND_OBSIDIAN),
    candidate:candidate('VERTICAL',vertical),
  }).allowed,true);
  const relaxed={...vertical,overridePolicy:{...vertical.overridePolicy,allowTypography:true}};
  assert.equal(governedThemeOverrideValidator({
    current:candidate('PLATFORM',EXPADIO_COMMAND_OBSIDIAN),
    candidate:candidate('VERTICAL',relaxed),
  }).allowed,false);
});
