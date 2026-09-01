import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  isPersonalAppearanceMode,
  loadPersonalAppearanceMode,
  persistPersonalAppearanceMode,
} from '@expadio/postgres-runtime/personal-appearance';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:Request){
  try{
    const context=await resolveRequestContext(request);
    const record=await withTenantTransaction(context,(client)=>
      loadPersonalAppearanceMode(client,context.tenantId,context.subjectId)
    );
    return NextResponse.json({mode:record?.mode??null});
  }catch(error){
    const denied=deniedResponse(error);
    return NextResponse.json(denied.body,{status:denied.status});
  }
}

export async function POST(request:Request){
  try{
    const context=await resolveRequestContext(request);
    const body=await request.json().catch(()=>null) as null|{mode?:unknown};
    if(!body||!isPersonalAppearanceMode(body.mode)){
      return NextResponse.json({denied:true,reasonKey:'APPEARANCE_MODE_INVALID',message:'Mode must be light, dark, or system.'},{status:400});
    }
    const result=await withTenantTransaction(context,(client)=>
      persistPersonalAppearanceMode(client,{
        valueId:randomUUID(),
        tenantId:context.tenantId,
        subjectId:context.subjectId,
        mode:body.mode,
        correlationId:randomUUID(),
      })
    );
    return NextResponse.json({mode:result.record.mode,appended:result.appended});
  }catch(error){
    const denied=deniedResponse(error);
    return NextResponse.json(denied.body,{status:denied.status});
  }
}
