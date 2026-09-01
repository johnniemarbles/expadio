import assert from 'node:assert/strict';
import test from 'node:test';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import {
  isPersonalAppearanceMode,
  loadPersonalAppearanceMode,
  persistPersonalAppearanceMode,
} from '../src/personal-appearance.ts';

class Client implements PostgresClient {
  readonly calls:Array<{text:string;values:readonly unknown[]}>= [];
  readonly steps:Array<SqlQueryResult|Error>=[];
  async query<Row=Record<string,unknown>>(text:string,values:readonly unknown[]=[]){
    this.calls.push({text,values});
    const step=this.steps.shift()??{rows:[],rowCount:0};
    if(step instanceof Error)throw step;
    return step as SqlQueryResult<Row>;
  }
}

const row={
  value_id:'11111111-1111-1111-1111-111111111111',
  tenant_id:'22222222-2222-2222-2222-222222222222',
  scope_id:'user-1',
  record_version:3,
  value:'dark',
  authored_at:'2026-09-01T18:00:00Z',
};

test('validates only the three supported personal modes',()=>{
  assert.equal(isPersonalAppearanceMode('light'),true);
  assert.equal(isPersonalAppearanceMode('dark'),true);
  assert.equal(isPersonalAppearanceMode('system'),true);
  assert.equal(isPersonalAppearanceMode('obsidian'),false);
  assert.equal(isPersonalAppearanceMode({mode:'dark'}),false);
});

test('loads only the exact tenant and subject preference',async()=>{
  const client=new Client();
  client.steps.push({rows:[row],rowCount:1});
  const result=await loadPersonalAppearanceMode(client,row.tenant_id,row.scope_id);
  assert.equal(result?.mode,'dark');
  assert.deepEqual(client.calls[0]?.values,[row.tenant_id,row.scope_id]);
  assert.match(client.calls[0]?.text??'',/level='USER_PREFERENCE'/);
  assert.match(client.calls[0]?.text??'',/tenant_id=\$1::uuid/);
  assert.match(client.calls[0]?.text??'',/scope_id=\$2/);
});

test('identical mode is idempotent after the serialization lock',async()=>{
  const client=new Client();
  client.steps.push({rows:[],rowCount:1});
  client.steps.push({rows:[row],rowCount:1});
  const result=await persistPersonalAppearanceMode(client,{
    valueId:'33333333-3333-3333-3333-333333333333',
    tenantId:row.tenant_id,
    subjectId:row.scope_id,
    mode:'dark',
    correlationId:'44444444-4444-4444-4444-444444444444',
  });
  assert.equal(result.appended,false);
  assert.equal(client.calls.length,2);
  assert.match(client.calls[0]?.text??'',/pg_advisory_xact_lock/);
  assert.doesNotMatch(client.calls.map(call=>call.text).join('\n'),/INSERT INTO platform\.configuration_setting_values/);
});

test('changed mode appends the next immutable user-preference version',async()=>{
  const client=new Client();
  client.steps.push({rows:[],rowCount:1});
  client.steps.push({rows:[row],rowCount:1});
  client.steps.push({rows:[{version:1}],rowCount:1});
  client.steps.push({rows:[{next_version:4}],rowCount:1});
  client.steps.push({rows:[{...row,record_version:4,value:'light'}],rowCount:1});
  const result=await persistPersonalAppearanceMode(client,{
    valueId:'33333333-3333-3333-3333-333333333333',
    tenantId:row.tenant_id,
    subjectId:row.scope_id,
    mode:'light',
    correlationId:'44444444-4444-4444-4444-444444444444',
  });
  assert.equal(result.appended,true);
  assert.equal(result.record.recordVersion,4);
  assert.equal(result.record.mode,'light');
  const sql=client.calls.map(call=>call.text).join('\n');
  assert.match(sql,/COALESCE\(MAX\(record_version\),0\)\+1/);
  assert.match(sql,/INSERT INTO platform\.configuration_setting_values/);
  assert.match(sql,/level.*USER_PREFERENCE|USER_PREFERENCE/s);
  assert.doesNotMatch(sql,/UPDATE platform\.configuration_setting_values|DELETE FROM platform\.configuration_setting_values/);
});
