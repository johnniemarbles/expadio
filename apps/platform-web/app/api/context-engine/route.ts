import { NextResponse } from 'next/server';
import { deniedResponse, resolveRequestContext, withTenantClient } from '../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);
    
    const rows = await withTenantClient(effectiveContext, async (client) => {
      const result = await client.query(
        `SELECT collection_reference as kind, COUNT(*)::int as count 
         FROM platform.knowledge_documents 
         WHERE tenant_id = $1 
         GROUP BY collection_reference
         ORDER BY count DESC`,
        [effectiveContext.tenantId]
      );
      return result.rows;
    });

    const dynamicContext = {
      bundleId: 'ctx-bundle-' + effectiveContext.tenantId.substring(0, 8),
      kinds: rows
    };
    return NextResponse.json(dynamicContext);
  } catch (error: any) {
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
