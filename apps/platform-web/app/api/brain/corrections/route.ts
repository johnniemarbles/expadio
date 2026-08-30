import { NextResponse } from 'next/server';
import type { CorrectionProposal } from '../../../../lib/brain-contracts';
import type { DeniedResult } from '@expadio/ui/contracts';
import { deniedResponse, resolveRequestContext, withTenantClient } from '../../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);

    const result = await withTenantClient(effectiveContext, (client) =>
      client.query(
        `SELECT proposal_reference, status, category, proposer_subject_id, created_at 
         FROM platform.company_brain_correction_proposals 
         WHERE tenant_id = $1
         ORDER BY created_at DESC`,
        [effectiveContext.tenantId]
      )
    );

    const corrections: CorrectionProposal[] = result.rows.map((row: any) => ({
      id: row.proposal_reference,
      title: 'Database Correction',
      category: row.category || 'fact',
      stage: row.status || 'reviewing',
      proposedBy: row.proposer_subject_id || 'system',
      evidenceRefs: [],
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.created_at || new Date().toISOString()
    }));

    return NextResponse.json(corrections);
  } catch (error: any) {
    console.error("Knowledge Corrections API Error:", error);
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
