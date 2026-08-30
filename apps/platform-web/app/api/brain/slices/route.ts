import { NextResponse } from 'next/server';
import type { ContextSlice } from '../../../../lib/brain-contracts';
import type { DeniedResult } from '@expadio/ui/contracts';
import { dbPool } from '../../../../lib/iam-adapter';
import { deniedResponse, resolveRequestContext } from '../../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);

    const result = await dbPool.query(
      `SELECT collection_reference as purpose, count(*)::int as count, max(indexed_at) as last_resolved
       FROM platform.knowledge_documents 
       WHERE tenant_id = $1
       GROUP BY collection_reference`, 
      [effectiveContext.tenantId]
    );

    const slices: ContextSlice[] = result.rows.map((row: any) => ({
      id: 'slice_' + row.purpose,
      purpose: row.purpose || 'Unknown Purpose',
      sourceCount: row.count || 1,
      itemLimit: 100,
      tenantScope: 'Global',
      lastResolved: row.last_resolved || new Date().toISOString()
    }));

    return NextResponse.json(slices);
  } catch (error: any) {
    console.error("Knowledge Slices API Error:", error);
    const denied = deniedResponse(error);
    if (denied.status !== 500) {
      return NextResponse.json(denied.body, { status: denied.status });
    }
    const body: DeniedResult = {
      denied: true,
      reasonKey: 'INTERNAL_ERROR',
      message: error.message || 'An unknown error occurred.'
    };
    return NextResponse.json(body, { status: 500 });
  }
}
