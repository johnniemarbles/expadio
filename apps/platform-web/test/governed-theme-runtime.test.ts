import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  EXPADIO_COMMAND_OBSIDIAN,
  governedThemeProfileValidator,
  isThemeOverride,
} from '@expadio/ui';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');

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

test('Platform shell resolves only the governed Platform master theme',()=>{
  const runtime=read('../lib/effective-theme.ts');
  const layout=read('../app/(shell)/layout.tsx');
  const shell=read('../components/ShellFrame/ShellFrame.tsx');
  assert.match(runtime,/resolveGovernedTheme\(service,values,\{\}\)/);
  assert.doesNotMatch(runtime,/tenantId:|brandId:|workspaceId:/);
  assert.match(layout,/compileScopedThemeCss/);
  assert.match(layout,/data-expadio-effective-theme="platform"/);
  assert.match(shell,/data-expadio-theme="platform"/);
});

test('theme persistence separates complete profiles from bounded Brand patches',()=>{
  const migration=read('../../../infra/db/migrations/0104_governed_theme_configuration.sql');
  assert.match(migration,/appearance\.theme\.profile/);
  assert.match(migration,/appearance\.theme\.override/);
  assert.match(migration,/ARRAY\['PLAN','VERTICAL'\]/);
  assert.match(migration,/ARRAY\['TENANT','BRAND','WORKSPACE'\]/);
});

test('Brand theme patches cannot smuggle protected theme fields',()=>{
  assert.equal(isThemeOverride({accent:'#ff3366',brandName:'ACME'}),true);
  assert.equal(isThemeOverride({canvas:'#000000'}),false);
  assert.equal(isThemeOverride({accent:'red'}),false);
});

test('Vertical profile cannot relax Platform override governance',()=>{
  const vertical={
    ...EXPADIO_COMMAND_OBSIDIAN,
    key:'clinical-obsidian',
    light:{...EXPADIO_COMMAND_OBSIDIAN.light,primary:'#0f766e'},
  };
  assert.equal(governedThemeProfileValidator({
    current:candidate('PLATFORM',EXPADIO_COMMAND_OBSIDIAN),
    candidate:candidate('VERTICAL',vertical),
  }).allowed,true);
  const relaxed={...vertical,overridePolicy:{...vertical.overridePolicy,allowTypography:true}};
  assert.equal(governedThemeProfileValidator({
    current:candidate('PLATFORM',EXPADIO_COMMAND_OBSIDIAN),
    candidate:candidate('VERTICAL',relaxed),
  }).allowed,false);
});
