import { NextRequest, NextResponse } from 'next/server';
import { ingestCommunicationProviderWebhook } from '@expadio/communication';
import { ResendWebhookNormalizer } from '@expadio/communication';
import { PostgresCommunicationDeliveryRepository } from '@expadio/postgres-runtime';
import { dbPool } from '../../../../lib/iam-adapter';

const deliveryRepository = new PostgresCommunicationDeliveryRepository(dbPool);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizer = new ResendWebhookNormalizer({
  resolveSecret: async (connectorKey: string) => {
    // Provider secret lookup is keyed by the explicit connector identifier.
    return process.env.RESEND_WEBHOOK_SECRET;
  },
});

export async function POST(req: NextRequest) {
  try {
    const rawBody = new Uint8Array(await req.arrayBuffer());
    
    // Extract headers
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // Webhook ingestion must be tenant-explicit. Production request paths must
    // reject absent tenant or connector context rather than substituting values.
    const searchParams = req.nextUrl.searchParams;
    const tenantId = searchParams.get('tenantId')?.trim();
    const connectorKey = searchParams.get('connectorKey')?.trim();

    if (!tenantId) {
      return NextResponse.json(
        { error: 'WEBHOOK_TENANT_REQUIRED', reason: 'tenantId query parameter is required' },
        { status: 400 },
      );
    }

    if (!UUID_PATTERN.test(tenantId)) {
      return NextResponse.json(
        { error: 'WEBHOOK_TENANT_INVALID', reason: 'tenantId must be a valid UUID' },
        { status: 400 },
      );
    }

    if (!connectorKey) {
      return NextResponse.json(
        { error: 'WEBHOOK_CONNECTOR_REQUIRED', reason: 'connectorKey query parameter is required' },
        { status: 400 },
      );
    }

    const requestObj = {
      connectorKey,
      headers,
      rawBody,
    };

    const result = await ingestCommunicationProviderWebhook({
      tenantId,
      request: requestObj,
      normalizer,
      deliveryRepository,
    });

    if (!result.accepted) {
      return NextResponse.json(
        { error: result.reasonCode, reason: result.reason },
        { status: result.reasonCode === 'WEBHOOK_SIGNATURE_INVALID' ? 401 : 400 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error processing Resend webhook:', error);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
  }
}
