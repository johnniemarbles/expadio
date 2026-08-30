import { NextResponse } from 'next/server';
import type { PlatformWorkspaceContext } from '../../../lib/contracts';
import { dbPool } from '../../../lib/iam-adapter';
import { deniedResponse, resolveRequestContext } from '../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const contextState = await resolveRequestContext(request);

    const result = await dbPool.query(
      'SELECT organization_id, name, status FROM platform.organizations WHERE tenant_id = $1 ORDER BY name ASC',
      [contextState.tenantId]
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
          id: contextState.tenantId,
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
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
