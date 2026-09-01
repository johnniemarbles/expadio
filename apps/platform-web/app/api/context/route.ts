import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { membershipRepository, dbPool } from '../../../lib/iam-adapter';
import type { PlatformWorkspaceContext } from '../../../lib/contracts';

/**
 * Workspace context is derived only from active persisted memberships. The
 * membership repository expands governed hierarchy scopes, so this endpoint
 * never upgrades "member of tenant" into "member of every organization".
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISSUER = 'https://clerk.expadio.com';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || 'W';
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'UNAUTHENTICATED',
      message: 'User is not authenticated',
    };
    return NextResponse.json(denied, { status: 401 });
  }

  try {
    const memberships = await membershipRepository.listActiveMemberships({
      subjectId: userId,
      issuer: ISSUER,
      actorKind: 'user',
    } as any);

    if (memberships.length === 0) {
      return NextResponse.json({ accounts: [], organizations: [] } satisfies PlatformWorkspaceContext);
    }

    const tenantIds = [...new Set(memberships.map((membership) => membership.tenantId))];
    const allowedOrganizationIds = [
      ...new Set(memberships.map((membership) => membership.organizationId)),
    ];

    const [tenantRows, orgRows] = await Promise.all([
      dbPool.query(
        'SELECT tenant_id, name FROM platform.tenants WHERE tenant_id = ANY($1::uuid[])',
        [tenantIds],
      ),
      dbPool.query(
        `SELECT organization_id, tenant_id, enterprise_id, name, organization_kind,
                parent_organization_id, status
           FROM platform.organizations
          WHERE organization_id = ANY($1::uuid[])
          ORDER BY name ASC`,
        [allowedOrganizationIds],
      ),
    ]);

    const tenantName = new Map<string, string>(
      tenantRows.rows.map((row: any) => [row.tenant_id, row.name]),
    );
    const organizationName = new Map<string, string>(
      orgRows.rows.map((row: any) => [row.organization_id, row.name]),
    );

    const accounts = tenantIds.map((tenantId) => {
      const name = tenantName.get(tenantId) ?? 'Workspace';
      const organizationIds = [
        ...new Set(
          memberships
            .filter((membership) => membership.tenantId === tenantId)
            .map((membership) => membership.organizationId)
            .filter((organizationId) => organizationName.has(organizationId)),
        ),
      ];
      return {
        id: tenantId,
        name,
        role: 'Platform operator',
        initials: initials(name),
        allowedOrganizationIds: organizationIds,
      };
    });

    const organizations = (orgRows.rows as any[]).map((row) => ({
      id: row.organization_id,
      name: row.name,
      environment: row.organization_kind,
      level: 'organization' as const,
      parentId: row.parent_organization_id ?? null,
    }));

    return NextResponse.json(
      { accounts, organizations } satisfies PlatformWorkspaceContext,
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error: any) {
    console.error('Workspace Context API Error:', error);
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'INTERNAL_ERROR',
      message: error.message || 'An unknown error occurred.',
    };
    return NextResponse.json(denied, { status: 500 });
  }
}
