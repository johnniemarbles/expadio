import { NextResponse } from 'next/server';
import type { ProvenanceEntry } from '../../../../lib/brain-contracts';
import type { DeniedResult } from '@expadio/ui/contracts';
import { deniedResponse, resolveRequestContext, withTenantClient } from '../../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);

    const [docsResult, proposalsResult] = await withTenantClient(effectiveContext, (client) =>
      Promise.all([
        client.query(
          `SELECT document_reference, source_reference, collection_reference,
                  document_version, indexed_by_subject_id, indexed_at, correlation_id
           FROM platform.knowledge_documents
           WHERE tenant_id = $1
           ORDER BY indexed_at DESC LIMIT 50`,
          [effectiveContext.tenantId]
        ),
        client.query(
          `SELECT proposal_reference, target_reference, proposer_subject_id,
                  created_at, reason_key, correlation_id
           FROM platform.company_brain_correction_proposals
           WHERE tenant_id = $1
           ORDER BY created_at DESC LIMIT 50`,
          [effectiveContext.tenantId]
        )
      ])
    );

    const docEntries: ProvenanceEntry[] = docsResult.rows.map((row: any) => ({
      id: 'prov_' + row.document_reference,
      sourceId: row.source_reference,
      action: 'indexed',
      actor: row.indexed_by_subject_id || 'system',
      timestamp: row.indexed_at || new Date().toISOString(),
      detail: 'Indexed version ' + (row.document_version || 1) + ' of ' + (row.collection_reference || 'Unknown'),
      auditRef: row.correlation_id || undefined
    }));

    const proposalEntries: ProvenanceEntry[] = proposalsResult.rows.map((row: any) => ({
      id: 'prov_' + row.proposal_reference,
      sourceId: row.target_reference,
      action: 'correction proposed',
      actor: row.proposer_subject_id || 'system',
      timestamp: row.created_at || new Date().toISOString(),
      detail: 'Correction: ' + (row.reason_key || 'Unknown'),
      auditRef: row.correlation_id || undefined
    }));

    const combined = [...docEntries, ...proposalEntries].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return NextResponse.json(combined);
  } catch (error: any) {
    console.error("Knowledge Provenance API Error:", error);
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
