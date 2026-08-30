import { NextResponse } from 'next/server';
import type { PublicationEvent } from '../../../../lib/brain-contracts';
import type { DeniedResult } from '@expadio/ui/contracts';
import { deniedResponse, resolveRequestContext, withTenantClient } from '../../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);

    const result = await withTenantClient(effectiveContext, (client) =>
      client.query(
        `SELECT document_reference, source_reference, collection_reference,
                document_version, indexed_by_subject_id, indexed_at
         FROM platform.knowledge_documents
         WHERE tenant_id = $1
         ORDER BY indexed_at DESC LIMIT 50`,
        [effectiveContext.tenantId]
      )
    );

    const items: PublicationEvent[] = result.rows.map((row: any) => ({
      id: row.document_reference,
      sourceId: row.source_reference,
      sourceName: row.collection_reference || 'Unknown',
      action: 'indexed' as const,
      performedBy: row.indexed_by_subject_id || 'system',
      timestamp: row.indexed_at || new Date().toISOString(),
      version: String(row.document_version || 1)
    }));

    return NextResponse.json(items);
  } catch (error: any) {
    console.error("Knowledge History API Error:", error);
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
