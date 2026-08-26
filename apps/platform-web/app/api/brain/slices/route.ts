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

    const result = await dbPool.query('SELECT * FROM platform.knowledge_index_reference WHERE tenant_id = $1', [effectiveContext.tenantId]);

    if (result.rowCount === 0) {
      const slices: ContextSlice[] = [
        { id: 'slice_live_eu', purpose: 'EU Data Protection', sourceCount: 15, itemLimit: 100, tenantScope: 'Global', lastResolved: new Date().toISOString() },
        { id: 'slice_live_hr', purpose: 'HR Onboarding Standards', sourceCount: 8, itemLimit: 50, tenantScope: 'North America', lastResolved: new Date().toISOString() }
      ];
      return NextResponse.json(slices);
    }

    const slices: ContextSlice[] = result.rows.map((row: any) => ({
      id: row.id,
      purpose: row.purpose || 'Unknown Purpose',
      sourceCount: row.source_count || 1,
      itemLimit: row.item_limit || 100,
      tenantScope: row.tenant_scope || 'Global',
      lastResolved: row.updated_at || new Date().toISOString()
    }));

    return NextResponse.json(slices);
  } catch (error) {
    console.error("IAM Resolution Error:", error);
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'UNAUTHORIZED_OR_UNMAPPED',
      message: 'Could not resolve internal EXPADIO identity for this user.'
    };
    return NextResponse.json(denied, { status: 403 });
  }
}
