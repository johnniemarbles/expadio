import {
  PLATFORM_JOURNEY_CORRELATION_ROUTE,
  assertPlatformPayloadHasNoCustomerPii,
  classifyRequestPath,
} from '@expadio/tenancy';
import { PLATFORM_PRODUCT_CACHE, platformProductDenied } from '../../../lib/platform-product-surface';
import { platformJourneyCorrelationBody } from '../../../lib/brand-host-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    if (classifyRequestPath(PLATFORM_JOURNEY_CORRELATION_ROUTE) !== 'platform-product') {
      return Response.json(platformProductDenied('WRONG_SURFACE'), { status: 500, headers: PLATFORM_PRODUCT_CACHE });
    }
    const url = new URL(request.url);
    const body = platformJourneyCorrelationBody(url.searchParams.get('correlation'));
    assertPlatformPayloadHasNoCustomerPii(body);
    return Response.json(body, { status: 200, headers: PLATFORM_PRODUCT_CACHE });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_JOURNEY_CORRELATION') {
      return Response.json(platformProductDenied('INVALID_JOURNEY_CORRELATION'), {
        status: 400,
        headers: PLATFORM_PRODUCT_CACHE,
      });
    }
    return Response.json(platformProductDenied(), { status: 500, headers: PLATFORM_PRODUCT_CACHE });
  }
}
