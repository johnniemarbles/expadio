import { NextResponse } from 'next/server';
import { dbPool } from '../../../lib/iam-adapter';
import { deniedResponse, resolveRequestContext } from '../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);
    
    const result = await dbPool.query(
      `SELECT collection_reference as kind, COUNT(*)::int as count 
       FROM platform.knowledge_documents 
       WHERE tenant_id = $1 
       GROUP BY collection_reference
       ORDER BY count DESC`,
      [effectiveContext.tenantId]
    );

    const dynamicContext = {
      bundleId: 'ctx-bundle-' + effectiveContext.tenantId.substring(0, 8),
      kinds: result.rows
    };
    return NextResponse.json(dynamicContext);
  } catch (error: any) {
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
