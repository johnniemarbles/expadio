import { auth } from '@clerk/nextjs/server';
import { brandHostStatus, assertPlatformPayloadHasNoCustomerPii } from '@expadio/tenancy';
import {
  PLATFORM_PRODUCT_CACHE,
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
    const payload = brandHostStatus(new URL(request.url).host);
    assertPlatformPayloadHasNoCustomerPii(payload);
    return Response.json(payload, { status: 200, headers: PLATFORM_PRODUCT_CACHE });
  } catch {
    return Response.json(platformProductDenied(), { status: 500, headers: PLATFORM_PRODUCT_CACHE });
  }
}
