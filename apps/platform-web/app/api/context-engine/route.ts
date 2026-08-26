import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../lib/iam-adapter';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    const denied: DeniedResult = { denied: true, reasonKey: 'UNAUTHENTICATED', message: 'User is not authenticated' };
    return NextResponse.json(denied, { status: 401 });
  }
  const resolve = () => authenticateAndResolveContext(
    { identityVerifier, membershipRepository },
    { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
  );
  try {
    const effectiveContext = await resolve();
    
    const result = await dbPool.query(
      `SELECT collection_reference as kind, COUNT(*)::int as count 
       FROM platform.knowledge_documents 
       WHERE tenant_id = $1 
       GROUP BY collection_reference
       ORDER BY count DESC`,
      [effectiveContext.tenantId]
    );

    const kinds = result.rows.length > 0 ? result.rows : [
        { kind: 'ORGANIZATION', count: 1 },
        { kind: 'TENANT', count: 1 },
        { kind: 'PERSONA', count: 1 },
        { kind: 'ROLE', count: 3 },
        { kind: 'POLICY', count: 5 }
    ];

    const dynamicContext = {
      bundleId: 'ctx-bundle-' + effectiveContext.tenantId.substring(0, 8),
      kinds
    };
    return NextResponse.json(dynamicContext);
  } catch (error: any) {
    const denied: DeniedResult = { denied: true, reasonKey: 'INTERNAL_ERROR', message: error.message || 'Unknown error' };
    return NextResponse.json(denied, { status: 500 });
  }
}
