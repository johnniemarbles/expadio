import { auth } from '@clerk/nextjs/server';
import { parseBrandCode, parseTenantCode, ScopeMappingError } from '@expadio/tenancy';
import { dbPool } from '../../../../lib/iam-adapter';
import {
  PLATFORM_PRODUCT_CACHE,
  assertPlatformProductPayload,
  platformProductDenied,
} from '../../../../lib/platform-product-surface';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json(platformProductDenied('UNAUTHENTICATED'), {
      status: 401,
      headers: PLATFORM_PRODUCT_CACHE,
    });
  }

  try {
    const url = new URL(request.url);
    const tenant = parseTenantCode(url.searchParams.get('tenant') ?? '');
    const brand = parseBrandCode(url.searchParams.get('brand') ?? '');
    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      const binding = await client.query<{ tenant_id: string }>(
        `SELECT tenant_id::text AS tenant_id
           FROM platform.lookup_product_scope_binding($1, $2, 'ALL')`,
        [tenant, brand],
      );
      const tenantId = binding.rows[0]?.tenant_id;
      if (!tenantId) throw new Error('PRODUCT_SCOPE_MAPPING_NOT_FOUND');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const delivery = await client.query<{ state: string | null }>(
        `SELECT d.state
           FROM platform.communication_deliveries d
          WHERE d.tenant_id = $1::uuid
            AND d.idempotency_key = 'cs104:communicate'
          LIMIT 1`,
        [tenantId],
      );
      await client.query('COMMIT');
      const state = delivery.rows[0]?.state ?? 'ABSENT';
      const payload = {
        tenant,
        brand,
        correlation: 'CS-104',
        delivery: state,
        deliveryClaimed: state === 'DELIVERED',
        source: 'communication_deliveries',
      };
      assertPlatformProductPayload(payload);
      return Response.json(payload, { status: 200, headers: PLATFORM_PRODUCT_CACHE });
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* keep original */
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof ScopeMappingError) {
      return Response.json(platformProductDenied(error.code), { status: 400, headers: PLATFORM_PRODUCT_CACHE });
    }
    const message = error instanceof Error ? error.message : '';
    if (message === 'PRODUCT_SCOPE_MAPPING_NOT_FOUND') {
      return Response.json(platformProductDenied(message), { status: 400, headers: PLATFORM_PRODUCT_CACHE });
    }
    return Response.json(platformProductDenied(), { status: 500, headers: PLATFORM_PRODUCT_CACHE });
  }
}
