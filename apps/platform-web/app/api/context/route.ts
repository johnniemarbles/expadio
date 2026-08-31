import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { membershipRepository, dbPool } from '../../../lib/iam-adapter';
import type { PlatformWorkspaceContext } from '../../../lib/contracts';
import { PLATFORM_PRODUCT_CACHE, platformProductDenied } from '../../../lib/platform-product-surface';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISSUER = 'https://clerk.expadio.com';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || 'W';
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    const denied: DeniedResult = { denied: true, reasonKey: 'UNAUTHENTICATED', message: 'User is not authenticated' };
    return NextResponse.json(denied, { status: 401, headers: PLATFORM_PRODUCT_CACHE });
  }

  try {
    const memberships = await membershipRepository.listActiveMemberships({
      subjectId: userId,
      issuer: ISSUER,
      actorKind: 'user',
    } as never);

    const tenantIds = [...new Set(memberships.map((m: { tenantId: string }) => m.tenantId))];
    if (tenantIds.length === 0) {
      return NextResponse.json({ accounts: [], organizations: [] } satisfies PlatformWorkspaceContext, {
        headers: PLATFORM_PRODUCT_CACHE,
      });
    }

    const [tenantRows, orgRows] = await Promise.all([
      dbPool.query('SELECT tenant_id, name FROM platform.tenants WHERE tenant_id = ANY($1::uuid[])', [tenantIds]),
      dbPool.query(
        'SELECT organization_id, tenant_id, name, status FROM platform.organizations WHERE tenant_id = ANY($1::uuid[]) ORDER BY name ASC',
        [tenantIds],
      ),
    ]);

    const tenantName = new Map<string, string>(tenantRows.rows.map((r: { tenant_id: string; name: string }) => [r.tenant_id, r.name]));
    const orgsByTenant = new Map<string, { id: string; name: string }[]>();
    for (const row of orgRows.rows as { tenant_id: string; organization_id: string; name: string }[]) {
      const list = orgsByTenant.get(row.tenant_id) ?? [];
      list.push({ id: row.organization_id, name: row.name });
      orgsByTenant.set(row.tenant_id, list);
    }

    const accounts = tenantIds.map((tenantId) => {
      const name = tenantName.get(tenantId) ?? 'Workspace';
      const orgs = orgsByTenant.get(tenantId) ?? [];
      return {
        id: tenantId,
        name,
        role: 'Platform operator',
        initials: initials(name),
        allowedOrganizationIds: orgs.map((o) => o.id),
      };
    });

    const organizations = (orgRows.rows as { organization_id: string; name: string }[]).map((row) => ({
      id: row.organization_id,
      name: row.name,
      environment: 'production',
      level: 'platform' as const,
      parentId: null,
    }));

    return NextResponse.json({ accounts, organizations } satisfies PlatformWorkspaceContext, {
      headers: PLATFORM_PRODUCT_CACHE,
    });
  } catch {
    return NextResponse.json(platformProductDenied(), { status: 500, headers: PLATFORM_PRODUCT_CACHE });
  }
}
