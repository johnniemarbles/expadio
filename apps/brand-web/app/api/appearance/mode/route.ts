import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  isPersonalAppearanceMode,
  loadPersonalAppearanceMode,
  persistPersonalAppearanceMode,
} from '@expadio/postgres-runtime/personal-appearance';
import {
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../lib/brand-context';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(){
  try{
    const context=await resolveBrandContext();
    const record=await withBrandTransaction(context,(client)=>
      loadPersonalAppearanceMode(client,context.tenantId,context.subjectId)
    );
    return NextResponse.json({mode:record?.mode??null});
  }catch{
    return NextResponse.json({denied:true,reasonKey:'APPEARANCE_MODE_READ_FAILED',message:'Appearance preference could not be loaded.'},{status:500});
  }
}

export async function POST(request:Request){
  try{
    const context=await resolveBrandContext();
    const body=await request.json().catch(()=>null) as null|{mode?:unknown};
    if(!body||!isPersonalAppearanceMode(body.mode)){
      return NextResponse.json({denied:true,reasonKey:'APPEARANCE_MODE_INVALID',message:'Mode must be light, dark, or system.'},{status:400});
    }
    const mode=body.mode;
    const result=await withBrandTransaction(context,(client)=>
      persistPersonalAppearanceMode(client,{
        valueId:randomUUID(),
        tenantId:context.tenantId,
        subjectId:context.subjectId,
        mode,
        correlationId:randomUUID(),
      })
    );
    return NextResponse.json({mode:result.record.mode,appended:result.appended});
  }catch{
    return NextResponse.json({denied:true,reasonKey:'APPEARANCE_MODE_WRITE_FAILED',message:'Appearance preference could not be saved.'},{status:500});
  }
}
