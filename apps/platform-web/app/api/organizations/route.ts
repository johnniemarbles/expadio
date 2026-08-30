import { NextResponse } from 'next/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { deniedResponse, resolveRequestContext, withTenantClient } from '../../../lib/request-context';
import type { PlatformOrganization } from '../../../lib/contracts';

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);
    const organizationId = effectiveContext.organizationId;

    if (!organizationId) {
      const denied: DeniedResult = {
        denied: true,
        reasonKey: 'ORGANIZATION_REQUIRED',
        message: 'Select an organization to continue.'
      };
      return NextResponse.json(denied, { status: 400 });
    }

    const result = await withTenantClient(effectiveContext, (client) =>
      client.query(
        `SELECT organization_id, name, parent_organization_id, organization_kind, status 
         FROM platform.organizations 
         WHERE tenant_id = $1 AND organization_id = $2`,
        [effectiveContext.tenantId, organizationId]
      )
    );

    if (result.rowCount === 0) {
      const denied: DeniedResult = {
        denied: true,
        reasonKey: 'ORGANIZATION_NOT_FOUND',
        message: 'The selected organization was not found in this workspace.'
      };
      return NextResponse.json(denied, { status: 404 });
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
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
