import { NextResponse } from 'next/server';
import { brandWorkspaceCookieNames, resolveBrandContext } from '../../../../lib/brand-context';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request:Request){
  const context=await resolveBrandContext();const form=await request.formData();const raw=form.get('workspace');
  const returnToRaw=form.get('returnTo');const returnTo=typeof returnToRaw==='string'&&returnToRaw.startsWith('/')?returnToRaw:'/learning';
  if(typeof raw!=='string')return NextResponse.json({error:'Workspace is required.'},{status:400});
  const [tenantId,organizationId]=raw.split(':');
  if(!tenantId||!organizationId||!UUID.test(tenantId)||!UUID.test(organizationId)||
    !context.workspaces.some((entry)=>entry.tenantId===tenantId&&entry.organizationId===organizationId)){
    return NextResponse.json({error:'Workspace is not available.'},{status:403});
  }
  const response=NextResponse.redirect(new URL(returnTo,request.url),303);
  const options={httpOnly:true,sameSite:'lax' as const,secure:process.env.NODE_ENV==='production',path:'/'};
  response.cookies.set(brandWorkspaceCookieNames.tenant,tenantId,options);
  response.cookies.set(brandWorkspaceCookieNames.organization,organizationId,options);
  return response;
}
