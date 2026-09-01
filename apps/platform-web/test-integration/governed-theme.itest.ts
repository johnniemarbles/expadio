import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  createEffectiveThemeService,
  governedThemeProfileValidator,
  resolveGovernedTheme,
  THEME_PROFILE_SETTING_KEY,
} from '@expadio/ui';
import {
  PostgresConfigurationSettingDefinitionRepository,
  PostgresConfigurationValueCandidateRepository,
} from '@expadio/postgres-runtime/governed-configuration';

function pool():pg.Pool{
  return new pg.Pool({
    host:process.env.PGHOST??'localhost',
    port:Number(process.env.PGPORT??5432),
    user:process.env.PGUSER??'postgres',
    password:process.env.PGPASSWORD??'postgres',
    database:process.env.PGDATABASE??'expadio_test',
    max:1,
  });
}

async function resolver(client:pg.PoolClient,context:{tenantId:string;brandId:string;workspaceId:string}){
  const values=new PostgresConfigurationValueCandidateRepository(client);
  const service=createEffectiveThemeService({
    definitions:new PostgresConfigurationSettingDefinitionRepository(
      client,
      new Map([[THEME_PROFILE_SETTING_KEY,governedThemeProfileValidator]]),
    ),
    values,
  });
  return resolveGovernedTheme(service,values,context,'2026-09-01T18:00:00Z');
}

test('governed theme inherits Platform profile and layers bounded tenant/workspace patches',async()=>{
  const p=pool();
  const c=await p.connect();
  const tenantId=randomUUID();
  const otherTenantId=randomUUID();
  const workspaceId=randomUUID();
  try{
    await c.query(
      `INSERT INTO platform.tenants (tenant_id,name) VALUES
       ($1::uuid,'Theme tenant'),($2::uuid,'Other theme tenant')`,
      [tenantId,otherTenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id',$1,false)`,[tenantId]);

    const baseline=await resolver(c,{tenantId,brandId:tenantId,workspaceId});
    assert.equal(baseline.fallback,false);
    assert.equal(baseline.theme.key,'expadio-command-obsidian');
    assert.equal(baseline.sourceLevel,'PLATFORM');

    await c.query(
      `INSERT INTO platform.configuration_setting_values (
         value_id,setting_key,definition_version,level,scope_id,tenant_id,
         record_version,value,effective_from,authored_by_subject_id,authored_at,
         reason,correlation_id,evidence_refs
       ) VALUES (
         $1::uuid,'appearance.theme.override',1,'TENANT',$2,$2::uuid,
         1,$3::jsonb,'2026-09-01T17:00:00Z','theme-itest',now(),
         'tenant accent proof',$4::uuid,ARRAY['itest:tenant-theme']
       )`,
      [randomUUID(),tenantId,JSON.stringify({accent:'#ff3366'}),randomUUID()],
    );

    // A workspace geometry mutation is syntactically valid but is rejected by
    // the inherited Obsidian policy because geometry overrides are locked.
    await c.query(
      `INSERT INTO platform.configuration_setting_values (
         value_id,setting_key,definition_version,level,scope_id,tenant_id,
         record_version,value,effective_from,authored_by_subject_id,authored_at,
         reason,correlation_id,evidence_refs
       ) VALUES (
         $1::uuid,'appearance.theme.override',1,'WORKSPACE',$2,$3::uuid,
         1,$4::jsonb,'2026-09-01T17:01:00Z','theme-itest',now(),
         'workspace policy proof',$5::uuid,ARRAY['itest:workspace-theme']
       )`,
      [randomUUID(),workspaceId,tenantId,JSON.stringify({cardRadius:'99px'}),randomUUID()],
    );

    // A different tenant must never participate in this tenant's candidate set.
    await c.query(
      `INSERT INTO platform.configuration_setting_values (
         value_id,setting_key,definition_version,level,scope_id,tenant_id,
         record_version,value,effective_from,authored_by_subject_id,authored_at,
         reason,correlation_id,evidence_refs
       ) VALUES (
         $1::uuid,'appearance.theme.override',1,'TENANT',$2,$2::uuid,
         1,$3::jsonb,'2026-09-01T17:02:00Z','theme-itest',now(),
         'cross tenant isolation proof',$4::uuid,ARRAY['itest:other-theme']
       )`,
      [randomUUID(),otherTenantId,JSON.stringify({accent:'#00ff00'}),randomUUID()],
    );

    const effective=await resolver(c,{tenantId,brandId:tenantId,workspaceId});
    assert.equal(effective.theme.light.accent,'#ff3366');
    assert.equal(effective.theme.dark.accent,'#ff3366');
    assert.equal(effective.theme.geometry.cardRadius,'14px');
    assert.equal(effective.sourceLevel,'TENANT');
    assert.ok(effective.trace.some((entry)=>
      entry.level==='WORKSPACE'
      && entry.outcome==='REJECTED'
      && entry.code==='THEME_GEOMETRY_OVERRIDE_LOCKED'
    ));
  }finally{
    c.release();
    await p.end();
  }
});
