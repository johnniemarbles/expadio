import { NextRequest, NextResponse } from 'next/server';
import { ingestCommunicationProviderWebhook } from '@expadio/communication/webhook-ingestion';
import { TwilioWebhookNormalizer } from '@expadio/communication/twilio-webhook-normalizer';
import { PostgresCommunicationDeliveryRepository } from '@expadio/postgres-runtime';
import { dbPool } from '../../../../lib/iam-adapter';

const deliveryRepository = new PostgresCommunicationDeliveryRepository(dbPool);

const normalizer = new TwilioWebhookNormalizer({
  adapterKey: 'twilio-sms-whatsapp-v1', // Can be either sms or voice depending on the routing.
  resolveAuthToken: async (connectorKey: string) => {
    return process.env.TWILIO_AUTH_TOKEN;
  },
  getWebhookUrl: (request) => {
    // Determine the original URL for signature validation
    return process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio`
      : 'https://example.com/api/webhooks/twilio'; 
  },
});

export async function POST(req: NextRequest) {
  try {
    const rawBody = new Uint8Array(await req.arrayBuffer());
    
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const searchParams = req.nextUrl.searchParams;
    const tenantId = searchParams.get('tenantId') || '00000000-0000-0000-0000-000000000001';
    const connectorKey = searchParams.get('connectorKey') || 'default-twilio';

    // We can inject the exact URL into the normalizer if we update the normalizer interface,
    // but the options.getWebhookUrl handles it based on request object (if we attach it).
    // For a real implementation, we could attach fullUrl to headers or use another approach.
    headers['x-forwarded-url'] = req.url;

    const normalizerWithUrl = new TwilioWebhookNormalizer({
      adapterKey: 'twilio-sms-whatsapp-v1',
      resolveAuthToken: async (key: string) => process.env.TWILIO_AUTH_TOKEN,
      getWebhookUrl: () => req.url,
    });

    const requestObj = {
      connectorKey,
      headers,
      rawBody,
    };

    const result = await ingestCommunicationProviderWebhook({
      tenantId,
      request: requestObj,
      normalizer: normalizerWithUrl,
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
    console.error('Error processing Twilio webhook:', error);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
  }
}
