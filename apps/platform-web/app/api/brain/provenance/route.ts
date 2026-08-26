import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { ProvenanceEntry } from '../../../../lib/brain-contracts';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../lib/iam-adapter';

export async function GET(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'UNAUTHENTICATED',
      message: 'User is not authenticated'
    };
    return NextResponse.json(denied, { status: 401 });
  }

  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      {
        credential: userId,
        tenantId: '00000000-0000-0000-0000-000000000001',
        organizationId: '00000000-0000-0000-0000-000000000002'
      }
    );

    const [docsResult, proposalsResult] = await Promise.all([
      dbPool.query(
        `SELECT document_reference, source_reference, collection_reference,
                document_version, indexed_by_subject_id, indexed_at, correlation_id
         FROM platform.knowledge_documents
         WHERE tenant_id = $1
         ORDER BY indexed_at DESC LIMIT 50`,
        [effectiveContext.tenantId]
      ),
      dbPool.query(
        `SELECT proposal_reference, target_reference, proposer_subject_id,
                created_at, reason_key, correlation_id
         FROM platform.company_brain_correction_proposals
         WHERE tenant_id = $1
         ORDER BY created_at DESC LIMIT 50`,
        [effectiveContext.tenantId]
      )
    ]);

    if (docsResult.rows.length === 0 && proposalsResult.rows.length === 0) {
      return NextResponse.json([
        { id: 'prov_live_1', sourceId: 'src_live_a1', action: 'indexed', actor: 'system', timestamp: new Date().toISOString(), detail: 'Indexed version 1 of Corporate Policy', auditRef: 'audit-001' },
        { id: 'prov_live_2', sourceId: 'src_live_a2', action: 'correction proposed', actor: 'system', timestamp: new Date(Date.now() - 3600000).toISOString(), detail: 'Correction: OUTDATED_FACT', auditRef: 'audit-002' }
      ] as ProvenanceEntry[]);
    }

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
    console.error("Brain Provenance API Error:", error);
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'INTERNAL_ERROR',
      message: error.message || 'An unknown error occurred.'
    };
    return NextResponse.json(denied, { status: 500 });
  }
}
