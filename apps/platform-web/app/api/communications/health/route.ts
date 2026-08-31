import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import {
  isCommunicationHealthKey,
  listCommunicationHealthSummary,
} from '../../../../lib/communication-health-summary';
import {
  PLATFORM_PRODUCT_CACHE,
  assertPlatformProductSendingHealth,
  platformProductDenied,
} from '../../../../lib/platform-product-surface';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function singleParam(searchParams: URLSearchParams, key: string): string | undefined {
  const value = searchParams.get(key)?.trim();
  return value === undefined || value === null || value === '' ? undefined : value;
}

/**
 * Tenant-scoped communication health summary.
 *
 * Product surface: counts and health keys only. Metadata is dropped because it
 * is an unbounded bag and may contain recipient fields.
 */
export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const { searchParams } = new URL(request.url);
    const healthKey = singleParam(searchParams, 'healthKey');

    if (healthKey !== undefined && !isCommunicationHealthKey(healthKey)) {
      return NextResponse.json(
        { error: 'Unsupported communication health key.' },
        { status: 400, headers: PLATFORM_PRODUCT_CACHE },
      );
    }

    const entries = await withTenantClient(context, async (client) => listCommunicationHealthSummary(client, {
      tenantId: context.tenantId,
      ...(healthKey === undefined ? {} : { healthKey }),
    }));

    const product = {
      entries: entries.map((entry) => ({
        tenantId: entry.tenantId,
        healthKey: entry.healthKey,
        healthStatus: entry.healthStatus,
        itemCount: entry.itemCount,
        oldestAt: entry.oldestAt,
        newestAt: entry.newestAt,
      })),
    };
    assertPlatformProductSendingHealth(product);
    return NextResponse.json(product, { headers: PLATFORM_PRODUCT_CACHE });
  } catch (error) {
    if (error instanceof Error && error.message === 'PLATFORM_PII_BOUNDARY') {
      return NextResponse.json(platformProductDenied('PLATFORM_PII_BOUNDARY'), {
        status: 500,
        headers: PLATFORM_PRODUCT_CACHE,
      });
    }
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status, headers: PLATFORM_PRODUCT_CACHE });
  }
}
