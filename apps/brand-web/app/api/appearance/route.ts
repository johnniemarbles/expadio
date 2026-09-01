import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  isThemeOverride,
  validateThemeOverrideAgainstPolicy,
  type ThemeOverride,
} from '@expadio/ui';
import {
  appendTenantThemeOverride,
  listTenantThemeOverrides,
} from '@expadio/postgres-runtime/theme-configuration';
import {
  hasBrandAdministrationRole,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../lib/brand-context';
import { loadBrandEffectiveTheme } from '../../../lib/effective-theme';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function reason(value:unknown):string{
  return typeof value==='string'&&value.trim()
    ? value.trim().slice(0,500)
    : 'Publish Brand appearance override.';
}

export async function POST(request:Request){
  try{
    const context=await resolveBrandContext();
    const body=await request.json().catch(()=>null) as null|Record<string,unknown>;
    if(!body)return NextResponse.json({denied:true,reasonKey:'THEME_REQUEST_INVALID',message:'A JSON request is required.'},{status:400});

    const result=await withBrandTransaction(context,async(client)=>{
      if(!(await hasBrandAdministrationRole(client,context.subjectId))){
        return {forbidden:true} as const;
      }

      let override:ThemeOverride|null=null;
      let evidence='appearance:brand-publication';

      if(body.override!==undefined){
        if(!isThemeOverride(body.override))return {invalid:true,reasonKey:'THEME_OVERRIDE_INVALID'} as const;
        override=body.override;
      }else if(Number.isInteger(body.rollbackRecordVersion)){
        const history=await listTenantThemeOverrides<unknown>(client,context.tenantId,100);
        const target=history.find((entry)=>entry.recordVersion===body.rollbackRecordVersion);
        if(!target||!isThemeOverride(target.value)){
          return {invalid:true,reasonKey:'THEME_ROLLBACK_VERSION_NOT_FOUND'} as const;
        }
        override=target.value;
        evidence='appearance:brand-rollback';
      }

      if(override===null)return {invalid:true,reasonKey:'THEME_OVERRIDE_REQUIRED'} as const;

      const effective=await loadBrandEffectiveTheme(client,context);
      const validation=validateThemeOverrideAgainstPolicy(effective.theme,override);
      if(!validation.allowed){
        return {invalid:true,reasonKey:validation.code,message:validation.reason} as const;
      }

      const correlationId=randomUUID();
      const published=await appendTenantThemeOverride(client,{
        valueId:randomUUID(),
        tenantId:context.tenantId,
        value:override,
        actorSubjectId:context.subjectId,
        reason:reason(body.reason),
        correlationId,
        evidenceRefs:[evidence,'theme:governed-publication'],
      });
      return {published,correlationId} as const;
    });

    if('forbidden' in result)return NextResponse.json({denied:true,reasonKey:'BRAND_ADMIN_REQUIRED',message:'Brand administration authority is required.'},{status:403});
    if('invalid' in result)return NextResponse.json({denied:true,reasonKey:result.reasonKey,message:'message' in result?result.message:'The requested Brand theme change is not valid.'},{status:400});
    return NextResponse.json(result);
  }catch(error){
    console.error('Brand appearance publication failed',error);
    return NextResponse.json({denied:true,reasonKey:'THEME_PUBLICATION_FAILED',message:'The Brand appearance change could not be published.'},{status:500});
  }
}
