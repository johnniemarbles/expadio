import { auth } from '@clerk/nextjs/server';
import { parseBrandCode, parseTenantCode, ScopeMappingError } from '@expadio/tenancy';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../lib/iam-adapter';
import {
  PLATFORM_PRODUCT_CACHE,
  assertPlatformProductPayload,
  platformProductDenied,
} from '../../../../lib/platform-product-surface';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json(platformProductDenied('UNAUTHENTICATED'), {
      status: 401,
      headers: PLATFORM_PRODUCT_CACHE,
    });
  }

  try {
    await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      {
        credential: userId,
        tenantId: '00000000-0000-0000-0000-000000000001',
        organizationId: '00000000-0000-0000-0000-000000000002',
      },
    );

    const body = (await request.json()) as Record<string, unknown>;
    const tenantCode = parseTenantCode(String(body.tenantCode ?? ''));
    const brandCode = parseBrandCode(String(body.brandCode ?? ''));

    const result = await dbPool.query(
      `SELECT correlation, schedule_status, task_status, communicate_status, delivery_state
         FROM platform.seed_cs104_observation($1, $2, $3)`,
      [userId, tenantCode, brandCode],
    );
    const row = result.rows[0];
    if (!row) {
      return Response.json(platformProductDenied('SEED_FAILED'), {
        status: 500,
        headers: PLATFORM_PRODUCT_CACHE,
      });
    }

    const payload = {
      correlation: row.correlation,
      schedule: row.schedule_status,
      task: row.task_status,
      communicate: row.communicate_status,
      delivery: row.delivery_state,
      brandHref: `/brand?tenant=${tenantCode}&brand=${brandCode}&location=ALL&view=communications`,
    };
    assertPlatformProductPayload(payload);
    return Response.json(payload, { status: 200, headers: PLATFORM_PRODUCT_CACHE });
  } catch (error) {
    if (error instanceof ScopeMappingError) {
      return Response.json(platformProductDenied(error.code), {
        status: 400,
        headers: PLATFORM_PRODUCT_CACHE,
      });
    }
    const message = error instanceof Error ? error.message : '';
    const known =
      message === 'NO_MEMBERSHIP' ||
      message === 'INVALID_PRODUCT_SCOPE_CODE' ||
      message === 'PRODUCT_SCOPE_MAPPING_NOT_FOUND';
    return Response.json(platformProductDenied(known ? message : 'INTERNAL_ERROR'), {
      status: known ? 409 : 500,
      headers: PLATFORM_PRODUCT_CACHE,
    });
  }
}
