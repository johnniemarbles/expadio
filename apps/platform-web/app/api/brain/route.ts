import { NextResponse } from 'next/server';
import type { BrainOverview } from '../../../lib/brain-contracts';
import type { DeniedResult } from '@expadio/ui/contracts';
import { deniedResponse, resolveRequestContext, withTenantClient } from '../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);

    const [sourcesResult, correctionsResult, lastIndexedResult] = await withTenantClient(effectiveContext, (client) =>
      Promise.all([
        client.query('SELECT count(*) as count FROM platform.knowledge_documents WHERE tenant_id = $1', [effectiveContext.tenantId]),
        client.query("SELECT count(*) as count FROM platform.company_brain_correction_proposals WHERE tenant_id = $1 AND status = 'UNREVIEWED'", [effectiveContext.tenantId]),
        client.query('SELECT max(indexed_at) as last_indexed_at FROM platform.knowledge_documents WHERE tenant_id = $1', [effectiveContext.tenantId])
      ])
    );

    const indexedSources = parseInt(sourcesResult.rows[0]?.count || '0', 10);
    const pendingCorrections = parseInt(correctionsResult.rows[0]?.count || '0', 10);
    const lastIndexedAt = lastIndexedResult.rows[0]?.last_indexed_at ?? null;

    const overview: BrainOverview = {
      source: { kind: 'live', label: 'Knowledge database', capturedAt: new Date().toISOString() },
      indexedSources,
      pendingCorrections,
      freshnessTargetHours: 24,
      lastIndexedAt: lastIndexedAt ? new Date(lastIndexedAt).toISOString() : '',
      healthSummary: indexedSources > 0 ? 'Indexed content available' : 'No indexed content available'
    };

    return NextResponse.json(overview);
  } catch (error: any) {
    console.error("Knowledge API Error:", error);
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
