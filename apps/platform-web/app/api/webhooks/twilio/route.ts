import { NextRequest, NextResponse } from 'next/server';
import { ingestCommunicationProviderWebhook } from '@expadio/communication';
import { TwilioWebhookNormalizer } from '@expadio/communication';
import { PostgresCommunicationDeliveryRepository } from '@expadio/postgres-runtime';
import { dbPool } from '../../../../lib/iam-adapter';

const deliveryRepository = new PostgresCommunicationDeliveryRepository(dbPool);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function badRequest(error: string, reason: string) {
  return NextResponse.json({ error, reason }, { status: 400 });
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = new Uint8Array(await req.arrayBuffer());
    
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const searchParams = req.nextUrl.searchParams;
    const tenantId = searchParams.get('tenantId')?.trim() ?? '';
    const connectorKey = searchParams.get('connectorKey')?.trim() ?? '';

    if (!uuidPattern.test(tenantId)) {
      return badRequest('TENANT_ID_REQUIRED', 'Twilio provider webhooks must include a valid tenantId.');
    }

    if (connectorKey.length === 0) {
      return badRequest('CONNECTOR_KEY_REQUIRED', 'Twilio provider webhooks must include connectorKey.');
    }

    // We can inject the exact URL into the normalizer if we update the normalizer interface,
    // but the options.getWebhookUrl handles it based on request object (if we attach it).
    // For a real implementation, we could attach fullUrl to headers or use another approach.
    headers['x-forwarded-url'] = req.url;

    const normalizerWithUrl = new TwilioWebhookNormalizer({
      adapterKey: 'twilio-sms-whatsapp-v1',
      resolveAuthToken: async () => process.env.TWILIO_AUTH_TOKEN,
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
