import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { PlatformOrganization } from '../../../lib/contracts';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../lib/iam-adapter';

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

    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('id') || '00000000-0000-0000-0000-000000000002';

    const result = await dbPool.query(
      `SELECT organization_id, name, status, organization_kind, parent_organization_id
       FROM platform.organizations
       WHERE organization_id = $1 AND tenant_id = $2`,
      [orgId, effectiveContext.tenantId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({
        id: orgId,
        name: 'Dreamware Platform',
        environment: 'production',
        level: 'platform',
        parentId: null
      } as PlatformOrganization);
    }

    const row = result.rows[0];
    const org: PlatformOrganization = {
      id: row.organization_id,
      name: row.name,
      environment: 'production',
      level: 'platform',
      parentId: row.parent_organization_id || null
    };

    return NextResponse.json(org);
  } catch (error: any) {
    console.error("Organizations API Error:", error);
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'INTERNAL_ERROR',
      message: error.message || 'An unknown error occurred.'
    };
    return NextResponse.json(denied, { status: 500 });
  }
}
