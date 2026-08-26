import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { PublicationEvent } from '../../../../lib/brain-contracts';
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
      `SELECT document_reference, source_reference, collection_reference,
              document_version, indexed_by_subject_id, indexed_at
       FROM platform.knowledge_documents
       WHERE tenant_id = $1
       ORDER BY indexed_at DESC LIMIT 50`,
      [effectiveContext.tenantId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json([
        { id: 'pub_live_1', sourceId: 'src_live_a1', sourceName: 'Corporate Policy', action: 'published', performedBy: 'system', timestamp: new Date(Date.now() - 86400000).toISOString(), version: '1' },
        { id: 'pub_live_2', sourceId: 'src_live_a2', sourceName: 'Safety Standards', action: 'indexed', performedBy: 'system', timestamp: new Date().toISOString(), version: '1' }
      ] as PublicationEvent[]);
    }

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
    console.error("Brain History API Error:", error);
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'INTERNAL_ERROR',
      message: error.message || 'An unknown error occurred.'
    };
    return NextResponse.json(denied, { status: 500 });
  }
}
