import { NextResponse } from 'next/server';
import type { BrainSource } from '../../../../lib/brain-contracts';
import type { DeniedResult } from '@expadio/ui/contracts';
import { deniedResponse, resolveRequestContext, withTenantClient } from '../../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);

    const result = await withTenantClient(effectiveContext, (client) =>
      client.query('SELECT * FROM platform.knowledge_documents WHERE tenant_id = $1', [effectiveContext.tenantId])
    );
    
    const sources: BrainSource[] = result.rows.map((row: any) => ({
      id: row.document_reference,
      name: row.source_reference ? row.source_reference.split('/').pop() : 'Unknown Source',
      kind: row.collection_reference || 'tenant-policy',
      precedence: 1,
      reviewStatus: 'approved',
      contentDigest: row.source_digest || '',
      effectiveDate: row.indexed_at || new Date().toISOString(),
      lastIndexed: row.indexed_at || new Date().toISOString(),
      classification: row.access_policy_key === 'default-read' ? 'Internal' : 'Confidential'
    }));

    return NextResponse.json(sources);
  } catch (error: any) {
    console.error("Knowledge Sources API Error:", error);
    const denied = deniedResponse(error);
    if (denied.status !== 500) {
      return NextResponse.json(denied.body, { status: denied.status });
    }
    const body: DeniedResult = {
      denied: true,
      reasonKey: 'INTERNAL_ERROR',
      message: 'An internal error occurred.'
    };
    return NextResponse.json(body, { status: 500 });
  }
}
