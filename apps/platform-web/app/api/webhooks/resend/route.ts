import { NextRequest, NextResponse } from 'next/server';
import { ingestCommunicationProviderWebhook } from '@expadio/communication';
import { ResendWebhookNormalizer } from '@expadio/communication';
import { PostgresCommunicationDeliveryRepository } from '@expadio/postgres-runtime';
import { dbPool } from '../../../../lib/iam-adapter';

const deliveryRepository = new PostgresCommunicationDeliveryRepository(dbPool);

const normalizer = new ResendWebhookNormalizer({
  resolveSecret: async (connectorKey: string) => {
    // In a real app, this might come from a credential registry based on the connectorKey.
    // For now, we fallback to an environment variable.
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

    // In a multitenant setup, tenantId and connectorKey might be passed in query params or derived from the URL path.
    const searchParams = req.nextUrl.searchParams;
    const tenantId = searchParams.get('tenantId') || '00000000-0000-0000-0000-000000000001';
    const connectorKey = searchParams.get('connectorKey') || 'default-resend';

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
