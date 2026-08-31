import { auth } from '@clerk/nextjs/server';
import { PLATFORM_PRODUCT_CACHE, platformProductDenied } from '../../../../lib/platform-product-surface';
import { platformPiiProofSample } from '../../../../lib/platform-cs104';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return Response.json(platformProductDenied('UNAUTHENTICATED'), {
      status: 401,
      headers: PLATFORM_PRODUCT_CACHE,
    });
  }
  try {
    return Response.json(platformPiiProofSample(), { status: 200, headers: PLATFORM_PRODUCT_CACHE });
  } catch {
    return Response.json(platformProductDenied('PLATFORM_PII_BOUNDARY'), {
      status: 500,
      headers: PLATFORM_PRODUCT_CACHE,
    });
  }
}
