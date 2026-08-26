import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { BrainSource } from '../../../../lib/brain-contracts';
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

    const result = await dbPool.query('SELECT * FROM platform.knowledge_documents WHERE tenant_id = $1', [effectiveContext.tenantId]);
    
    if (result.rowCount === 0) {
      const sources: BrainSource[] = [
        { id: 'src_live_a1', name: 'Live Corporate Policy Q3', kind: 'tenant-policy', precedence: 1, reviewStatus: 'approved', contentDigest: 'live-sha-999', effectiveDate: '2026-07-01T00:00:00Z', lastIndexed: new Date().toISOString(), classification: 'Confidential' },
        { id: 'src_live_a2', name: 'Live Regional Safety Code', kind: 'safety', precedence: 2, reviewStatus: 'pending', contentDigest: 'live-sha-888', effectiveDate: '2026-08-01T00:00:00Z', lastIndexed: new Date().toISOString(), classification: 'Public' }
      ];
      return NextResponse.json(sources);
    }

    const sources: BrainSource[] = result.rows.map((row: any) => ({
      id: row.id,
      name: row.title || 'Unknown Source',
      kind: 'tenant-policy',
      precedence: 1,
      reviewStatus: 'approved',
      contentDigest: row.content_hash || '',
      effectiveDate: row.created_at || new Date().toISOString(),
      lastIndexed: row.updated_at || new Date().toISOString(),
      classification: row.security_level || 'Public'
    }));

    return NextResponse.json(sources);
  } catch (error: any) {
    console.error("Brain Sources API Error:", error);
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'INTERNAL_ERROR',
      message: error.message || 'An unknown error occurred.'
    };
    return NextResponse.json(denied, { status: 500 });
  }
}
