import type { PostgresClient } from './index.ts';

export type PersonalAppearanceMode='light'|'dark'|'system';

export interface PersonalAppearanceModeRecord {
  readonly valueId:string;
  readonly tenantId:string;
  readonly subjectId:string;
  readonly recordVersion:number;
  readonly mode:PersonalAppearanceMode;
  readonly authoredAt:string;
}

interface Row {
  readonly value_id:string;
  readonly tenant_id:string;
  readonly scope_id:string;
  readonly record_version:number;
  readonly value:unknown;
  readonly authored_at:Date|string;
}

export function isPersonalAppearanceMode(value:unknown):value is PersonalAppearanceMode{
  return value==='light'||value==='dark'||value==='system';
}

function map(row:Row):PersonalAppearanceModeRecord{
  if(!isPersonalAppearanceMode(row.value))throw new Error('PERSONAL_APPEARANCE_MODE_INVALID');
  return {
    valueId:row.value_id,
    tenantId:row.tenant_id,
    subjectId:row.scope_id,
    recordVersion:row.record_version,
    mode:row.value,
    authoredAt:row.authored_at instanceof Date?row.authored_at.toISOString():new Date(row.authored_at).toISOString(),
  };
}

async function definitionVersion(client:PostgresClient):Promise<number>{
  const result=await client.query<{version:number}>(
    `SELECT version
       FROM platform.configuration_setting_definitions
      WHERE setting_key='appearance.theme.mode'
        AND effective_from<=now()
      ORDER BY effective_from DESC,version DESC
      LIMIT 1`,
  );
  const version=result.rows[0]?.version;
  if(version===undefined)throw new Error('PERSONAL_APPEARANCE_DEFINITION_MISSING');
  return version;
}

export async function loadPersonalAppearanceMode(
  client:PostgresClient,
  tenantId:string,
  subjectId:string,
):Promise<PersonalAppearanceModeRecord|null>{
  const result=await client.query<Row>(
    `SELECT value_id,tenant_id,scope_id,record_version,value,authored_at
       FROM platform.configuration_setting_values
      WHERE setting_key='appearance.theme.mode'
        AND level='USER_PREFERENCE'
        AND tenant_id=$1::uuid
        AND scope_id=$2
        AND effective_from<=now()
        AND (effective_until IS NULL OR effective_until>now())
      ORDER BY record_version DESC,effective_from DESC,value_id DESC
      LIMIT 1`,
    [tenantId,subjectId],
  );
  const row=result.rows[0];
  return row===undefined?null:map(row);
}

export async function persistPersonalAppearanceMode(
  client:PostgresClient,
  input:{
    readonly valueId:string;
    readonly tenantId:string;
    readonly subjectId:string;
    readonly mode:PersonalAppearanceMode;
    readonly correlationId:string;
  },
):Promise<{readonly record:PersonalAppearanceModeRecord;readonly appended:boolean}>{
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext('appearance.theme.mode:'||$1::text||':'||$2))`,
    [input.tenantId,input.subjectId],
  );

  const current=await loadPersonalAppearanceMode(client,input.tenantId,input.subjectId);
  if(current?.mode===input.mode)return {record:current,appended:false};

  const definition=await definitionVersion(client);
  const version=await client.query<{next_version:number}>(
    `SELECT COALESCE(MAX(record_version),0)+1 AS next_version
       FROM platform.configuration_setting_values
      WHERE setting_key='appearance.theme.mode'
        AND level='USER_PREFERENCE'
        AND tenant_id=$1::uuid
        AND scope_id=$2`,
    [input.tenantId,input.subjectId],
  );
  const next=version.rows[0]?.next_version??1;
  const inserted=await client.query<Row>(
    `INSERT INTO platform.configuration_setting_values (
       value_id,setting_key,definition_version,level,scope_id,tenant_id,
       record_version,value,effective_from,effective_until,
       authored_by_subject_id,authored_at,reason,correlation_id,evidence_refs
     ) VALUES (
       $1::uuid,'appearance.theme.mode',$2,'USER_PREFERENCE',$3,$4::uuid,
       $5,$6::jsonb,now(),NULL,$3,now(),
       'Persist personal appearance mode.',$7::uuid,ARRAY['theme:personal-mode']
     )
     RETURNING value_id,tenant_id,scope_id,record_version,value,authored_at`,
    [input.valueId,definition,input.subjectId,input.tenantId,next,JSON.stringify(input.mode),input.correlationId],
  );
  const row=inserted.rows[0];
  if(row===undefined)throw new Error('PERSONAL_APPEARANCE_PERSIST_FAILED');
  return {record:map(row),appended:true};
}
