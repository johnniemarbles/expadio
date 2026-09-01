import type { PostgresClient } from './index.ts';

export interface ThemeConfigurationRecord<Value = unknown> {
  readonly valueId:string;
  readonly settingKey:'appearance.theme.profile'|'appearance.theme.override';
  readonly level:'PLATFORM'|'TENANT';
  readonly scopeId:string|null;
  readonly tenantId:string|null;
  readonly recordVersion:number;
  readonly value:Value;
  readonly authoredBySubjectId:string;
  readonly authoredAt:string;
  readonly reason:string;
  readonly correlationId:string;
}

interface ThemeValueRow {
  readonly value_id:string;
  readonly setting_key:ThemeConfigurationRecord['settingKey'];
  readonly level:ThemeConfigurationRecord['level'];
  readonly scope_id:string|null;
  readonly tenant_id:string|null;
  readonly record_version:number;
  readonly value:unknown;
  readonly authored_by_subject_id:string;
  readonly authored_at:Date|string;
  readonly reason:string;
  readonly correlation_id:string;
}

function iso(value:Date|string):string{
  return value instanceof Date?value.toISOString():new Date(value).toISOString();
}

function record<Value>(row:ThemeValueRow):ThemeConfigurationRecord<Value>{
  return {
    valueId:row.value_id,
    settingKey:row.setting_key,
    level:row.level,
    scopeId:row.scope_id,
    tenantId:row.tenant_id,
    recordVersion:row.record_version,
    value:row.value as Value,
    authoredBySubjectId:row.authored_by_subject_id,
    authoredAt:iso(row.authored_at),
    reason:row.reason,
    correlationId:row.correlation_id,
  };
}

async function definitionVersion(client:PostgresClient,settingKey:string):Promise<number>{
  const result=await client.query<{version:number}>(
    `SELECT version
       FROM platform.configuration_setting_definitions
      WHERE setting_key=$1
        AND effective_from<=now()
      ORDER BY effective_from DESC,version DESC
      LIMIT 1`,
    [settingKey],
  );
  const row=result.rows[0];
  if(!row)throw new Error('THEME_CONFIGURATION_DEFINITION_MISSING');
  return row.version;
}

export async function appendPlatformThemeProfile<Value extends Readonly<Record<string,unknown>>>(
  client:PostgresClient,
  input:{
    readonly valueId:string;
    readonly value:Value;
    readonly actorSubjectId:string;
    readonly reason:string;
    readonly correlationId:string;
    readonly evidenceRefs:readonly string[];
  },
):Promise<ThemeConfigurationRecord<Value>>{
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('appearance.theme.profile:PLATFORM'))`);
  const definition=await definitionVersion(client,'appearance.theme.profile');
  const version=await client.query<{next_version:number}>(
    `SELECT COALESCE(MAX(record_version),0)+1 AS next_version
       FROM platform.configuration_setting_values
      WHERE setting_key='appearance.theme.profile'
        AND level='PLATFORM'
        AND scope_id IS NULL`,
  );
  const next=version.rows[0]?.next_version??1;
  const inserted=await client.query<ThemeValueRow>(
    `INSERT INTO platform.configuration_setting_values (
       value_id,setting_key,definition_version,level,scope_id,tenant_id,
       record_version,value,effective_from,effective_until,
       authored_by_subject_id,authored_at,reason,correlation_id,evidence_refs
     ) VALUES (
       $1::uuid,'appearance.theme.profile',$2,'PLATFORM',NULL,NULL,
       $3,$4::jsonb,now(),NULL,$5,now(),$6,$7::uuid,$8::text[]
     )
     RETURNING value_id,setting_key,level,scope_id,tenant_id,record_version,value,
               authored_by_subject_id,authored_at,reason,correlation_id::text`,
    [
      input.valueId,definition,next,JSON.stringify(input.value),input.actorSubjectId,
      input.reason,input.correlationId,[...input.evidenceRefs],
    ],
  );
  const row=inserted.rows[0];
  if(!row)throw new Error('THEME_PROFILE_PUBLISH_FAILED');
  return record<Value>(row);
}

export async function appendTenantThemeOverride<Value extends Readonly<Record<string,unknown>>>(
  client:PostgresClient,
  input:{
    readonly valueId:string;
    readonly tenantId:string;
    readonly value:Value;
    readonly actorSubjectId:string;
    readonly reason:string;
    readonly correlationId:string;
    readonly evidenceRefs:readonly string[];
  },
):Promise<ThemeConfigurationRecord<Value>>{
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext('appearance.theme.override:'||$1::text))`,
    [input.tenantId],
  );
  const definition=await definitionVersion(client,'appearance.theme.override');
  const version=await client.query<{next_version:number}>(
    `SELECT COALESCE(MAX(record_version),0)+1 AS next_version
       FROM platform.configuration_setting_values
      WHERE setting_key='appearance.theme.override'
        AND level='TENANT'
        AND tenant_id=$1::uuid
        AND scope_id=$1::text`,
    [input.tenantId],
  );
  const next=version.rows[0]?.next_version??1;
  const inserted=await client.query<ThemeValueRow>(
    `INSERT INTO platform.configuration_setting_values (
       value_id,setting_key,definition_version,level,scope_id,tenant_id,
       record_version,value,effective_from,effective_until,
       authored_by_subject_id,authored_at,reason,correlation_id,evidence_refs
     ) VALUES (
       $1::uuid,'appearance.theme.override',$2,'TENANT',$3::text,$3::uuid,
       $4,$5::jsonb,now(),NULL,$6,now(),$7,$8::uuid,$9::text[]
     )
     RETURNING value_id,setting_key,level,scope_id,tenant_id,record_version,value,
               authored_by_subject_id,authored_at,reason,correlation_id::text`,
    [
      input.valueId,definition,input.tenantId,next,JSON.stringify(input.value),
      input.actorSubjectId,input.reason,input.correlationId,[...input.evidenceRefs],
    ],
  );
  const row=inserted.rows[0];
  if(!row)throw new Error('THEME_OVERRIDE_PUBLISH_FAILED');
  return record<Value>(row);
}

export async function listPlatformThemeProfiles<Value=unknown>(
  client:PostgresClient,
  limit=20,
):Promise<readonly ThemeConfigurationRecord<Value>[]>{
  const result=await client.query<ThemeValueRow>(
    `SELECT value_id,setting_key,level,scope_id,tenant_id,record_version,value,
            authored_by_subject_id,authored_at,reason,correlation_id::text
       FROM platform.configuration_setting_values
      WHERE setting_key='appearance.theme.profile'
        AND level='PLATFORM'
        AND scope_id IS NULL
      ORDER BY record_version DESC
      LIMIT $1`,
    [Math.max(1,Math.min(limit,100))],
  );
  return result.rows.map((row)=>record<Value>(row));
}

export async function listTenantThemeOverrides<Value=unknown>(
  client:PostgresClient,
  tenantId:string,
  limit=20,
):Promise<readonly ThemeConfigurationRecord<Value>[]>{
  const result=await client.query<ThemeValueRow>(
    `SELECT value_id,setting_key,level,scope_id,tenant_id,record_version,value,
            authored_by_subject_id,authored_at,reason,correlation_id::text
       FROM platform.configuration_setting_values
      WHERE setting_key='appearance.theme.override'
        AND level='TENANT'
        AND tenant_id=$1::uuid
        AND scope_id=$1::text
      ORDER BY record_version DESC
      LIMIT $2`,
    [tenantId,Math.max(1,Math.min(limit,100))],
  );
  return result.rows.map((row)=>record<Value>(row));
}
