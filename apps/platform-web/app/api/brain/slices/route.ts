import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { ContextSlice } from '../../../../lib/brain-contracts';
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

    const result = await dbPool.query(
      `SELECT collection_reference as purpose, count(*)::int as count, max(indexed_at) as last_resolved
       FROM platform.knowledge_documents 
       WHERE tenant_id = $1
       GROUP BY collection_reference`, 
      [effectiveContext.tenantId]
    );

    if (result.rowCount === 0) {
      const slices: ContextSlice[] = [
        { id: 'slice_live_eu', purpose: 'EU Data Protection', sourceCount: 15, itemLimit: 100, tenantScope: 'Global', lastResolved: new Date().toISOString() },
        { id: 'slice_live_hr', purpose: 'HR Onboarding Standards', sourceCount: 8, itemLimit: 50, tenantScope: 'North America', lastResolved: new Date().toISOString() }
      ];
      return NextResponse.json(slices);
    }

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
    console.error("Brain Slices API Error:", error);
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'INTERNAL_ERROR',
      message: error.message || 'An unknown error occurred.'
    };
    return NextResponse.json(denied, { status: 500 });
  }
}
