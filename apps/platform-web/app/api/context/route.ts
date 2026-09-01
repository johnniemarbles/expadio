import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { membershipRepository, dbPool } from '../../../lib/iam-adapter';
import type { PlatformWorkspaceContext } from '../../../lib/contracts';

/**
 * Workspace context is derived only from active persisted memberships. The
 * membership repository expands governed hierarchy scopes, and each tenant's
 * descriptive rows are then read inside an explicit tenant-bound transaction.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISSUER = 'https://clerk.expadio.com';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || 'W';
}

async function loadTenantWorkspaceRows(
  tenantId: string,
  organizationIds: readonly string[],
  subjectId: string,
) {
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.subject_id', subjectId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.issuer', ISSUER]);

    const tenant = await client.query(
      'SELECT tenant_id, name FROM platform.tenants WHERE tenant_id = $1::uuid',
      [tenantId],
    );
    const organizations =
      organizationIds.length === 0
        ? { rows: [] as any[] }
        : await client.query(
            `SELECT organization_id, tenant_id, enterprise_id, name, organization_kind,
                    parent_organization_id, status
               FROM platform.organizations
              WHERE tenant_id = $1::uuid
                AND organization_id = ANY($2::uuid[])
              ORDER BY name ASC`,
            [tenantId, organizationIds],
          );

    await client.query('COMMIT');
    return { tenant: tenant.rows[0] as any, organizations: organizations.rows as any[] };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original database failure.
    }
    throw error;
  } finally {
    client.release();
  }
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
    const tenantResults = await Promise.all(
      tenantIds.map((tenantId) => {
        const organizationIds = [
          ...new Set(
            memberships
              .filter((membership) => membership.tenantId === tenantId)
              .map((membership) => membership.organizationId),
          ),
        ];
        return loadTenantWorkspaceRows(tenantId, organizationIds, userId);
      }),
    );

    const accounts = tenantResults.map(({ tenant, organizations }, index) => {
      const tenantId = tenantIds[index]!;
      const name = tenant?.name ?? 'Workspace';
      return {
        id: tenantId,
        name,
        role: 'Platform operator',
        initials: initials(name),
        allowedOrganizationIds: organizations.map((organization) => organization.organization_id),
      };
    });

    const organizations = tenantResults.flatMap((result) =>
      result.organizations.map((row) => ({
        id: row.organization_id,
        name: row.name,
        environment: row.organization_kind,
        level: 'organization' as const,
        parentId: row.parent_organization_id ?? null,
      })),
    );

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
