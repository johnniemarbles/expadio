import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../lib/iam-adapter';
import type { PlatformWorkspaceContext } from '../../../lib/contracts';

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
      'SELECT organization_id, name, status FROM platform.organizations WHERE tenant_id = $1 ORDER BY name ASC',
      [effectiveContext.tenantId]
    );

    const organizations = result.rows.map((row: any) => ({
      id: row.organization_id,
      name: row.name,
      environment: 'production',
      level: 'platform' as const,
      parentId: null
    }));

    const context: PlatformWorkspaceContext = {
      accounts: [
        {
          id: effectiveContext.tenantId,
          name: 'Live Account',
          role: 'Platform owner',
          initials: 'LA',
          allowedOrganizationIds: organizations.map(org => org.id)
        }
      ],
      organizations
    };

    return NextResponse.json(context);
  } catch (error: any) {
    console.error("Workspace Context API Error:", error);
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'INTERNAL_ERROR',
      message: error.message || 'An unknown error occurred.'
    };
    return NextResponse.json(denied, { status: 500 });
  }
}
