import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  EXPADIO_THEME_PRESETS,
  isExpadioThemeDefinition,
  type ExpadioThemeDefinition,
} from '@expadio/ui';
import {
  appendPlatformThemeProfile,
  listPlatformThemeProfiles,
} from '@expadio/postgres-runtime/theme-configuration';
import { hasPlatformAdministrationRole } from '@/lib/governance-authz';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function preset(key:unknown):ExpadioThemeDefinition|null{
  if(typeof key!=='string')return null;
  return (EXPADIO_THEME_PRESETS as Record<string,ExpadioThemeDefinition>)[key]??null;
}

function reason(value:unknown):string{
  return typeof value==='string'&&value.trim()
    ? value.trim().slice(0,500)
    : 'Publish appearance profile from Platform Appearance Manager.';
}

export async function POST(request:Request){
  try{
    const context=await resolveRequestContext(request);
    const body=await request.json().catch(()=>null) as null|Record<string,unknown>;
    if(!body)return NextResponse.json({denied:true,reasonKey:'THEME_REQUEST_INVALID',message:'A JSON request is required.'},{status:400});

    const result=await withTenantTransaction(context,async(client)=>{
      if(!(await hasPlatformAdministrationRole(client,context.subjectId))){
        return {forbidden:true} as const;
      }

      let value:ExpadioThemeDefinition|null=preset(body.presetKey);
      let evidence='appearance:preset-publication';

      if(value===null&&Number.isInteger(body.rollbackRecordVersion)){
        const history=await listPlatformThemeProfiles<unknown>(client,100);
        const target=history.find((entry)=>entry.recordVersion===body.rollbackRecordVersion);
        if(!target||!isExpadioThemeDefinition(target.value)){
          return {invalid:true,reasonKey:'THEME_ROLLBACK_VERSION_NOT_FOUND'} as const;
        }
        value=target.value;
        evidence='appearance:rollback';
      }

      if(value===null)return {invalid:true,reasonKey:'THEME_PROFILE_NOT_APPROVED'} as const;

      const correlationId=randomUUID();
      const published=await appendPlatformThemeProfile(client,{
        valueId:randomUUID(),
        value,
        actorSubjectId:context.subjectId,
        reason:reason(body.reason),
        correlationId,
        evidenceRefs:[evidence,'theme:governed-publication'],
      });
      return {published,theme:value,correlationId} as const;
    });

    if('forbidden' in result)return NextResponse.json({denied:true,reasonKey:'PLATFORM_ADMIN_REQUIRED',message:'Platform administration authority is required.'},{status:403});
    if('invalid' in result)return NextResponse.json({denied:true,reasonKey:result.reasonKey,message:'The requested theme publication is not available.'},{status:400});
    return NextResponse.json(result);
  }catch(error){
    const denied=deniedResponse(error);
    return NextResponse.json(denied.body,{status:denied.status});
  }
}
