import { auth } from '@clerk/nextjs/server';
import {
  PLATFORM_JOURNEY_CORRELATION_ROUTE,
  ScopeMappingError,
  assertPlatformPayloadHasNoCustomerPii,
  classifyRequestPath,
} from '@expadio/tenancy';
import { PLATFORM_PRODUCT_CACHE, platformProductDenied } from '../../../lib/platform-product-surface';
import { platformJourneyCorrelationBody } from '../../../lib/brand-host-runtime';
import { dbPool } from '../../../lib/iam-adapter';
import { readPlatformCs104 } from '../../../lib/platform-cs104';

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
    if (classifyRequestPath(PLATFORM_JOURNEY_CORRELATION_ROUTE) !== 'platform-product') {
      return Response.json(platformProductDenied('WRONG_SURFACE'), { status: 500, headers: PLATFORM_PRODUCT_CACHE });
    }
    const url = new URL(request.url);
    const tenant = url.searchParams.get('tenant');
    const brand = url.searchParams.get('brand');
    if (!tenant || !brand) {
      const body = platformJourneyCorrelationBody(url.searchParams.get('correlation'));
      assertPlatformPayloadHasNoCustomerPii(body);
      return Response.json(body, { status: 200, headers: PLATFORM_PRODUCT_CACHE });
    }

    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      const payload = await readPlatformCs104(client, {
        tenantCode: tenant,
        brandCode: brand,
        correlation: url.searchParams.get('correlation'),
      });
      await client.query('COMMIT');
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
    if (message === 'INVALID_JOURNEY_CORRELATION' || message === 'PRODUCT_SCOPE_MAPPING_NOT_FOUND') {
      return Response.json(platformProductDenied(message), { status: 400, headers: PLATFORM_PRODUCT_CACHE });
    }
    if (message === 'PLATFORM_PII_BOUNDARY') {
      return Response.json(platformProductDenied('PLATFORM_PII_BOUNDARY'), {
        status: 500,
        headers: PLATFORM_PRODUCT_CACHE,
      });
    }
    return Response.json(platformProductDenied(), { status: 500, headers: PLATFORM_PRODUCT_CACHE });
  }
}
