import { NextResponse } from 'next/server';
import { listIndustryPackCatalog } from '@expadio/industry-packs';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';

/**
 * The Industry Pack management plane (read model): the full catalog of available
 * packs and what each one configures, plus the workspace's current binding. A
 * membership read — RLS keeps the binding within the caller's tenant. Binding a
 * pack is a governed write on /api/tenancy/vertical (PATCH); this is the surface
 * an admin reviews before choosing.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const verticalKey = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT vertical_key FROM platform.tenants WHERE tenant_id = $1::uuid`,
        [context.tenantId],
      );
      return result.rows[0]?.vertical_key ?? null;
    });
    return NextResponse.json({ verticalKey, catalog: listIndustryPackCatalog() });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
