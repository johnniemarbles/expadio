import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  signResendWebhookForTest,
  verifyResendWebhookSignature,
} from '../lib/resend-webhook-verification.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const route = read('../app/api/webhooks/resend/route.ts');

const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const payload = '{"type":"email.delivered","data":{"id":"email_123"}}';
const timestamp = '1788089400';
const messageId = 'msg_test_123';

test('Resend webhook signature verification uses raw Svix payload signing', () => {
  const signature = signResendWebhookForTest({
    secret,
    messageId,
    timestamp,
    payload,
  });

  assert.doesNotThrow(() => verifyResendWebhookSignature({
    secret,
    payload,
    headers: {
      id: messageId,
      timestamp,
      signature,
    },
    nowMs: Number.parseInt(timestamp, 10) * 1000,
  }));

  assert.throws(() => verifyResendWebhookSignature({
    secret,
    payload: JSON.stringify(JSON.parse(payload), null, 2),
    headers: {
      id: messageId,
      timestamp,
      signature,
    },
    nowMs: Number.parseInt(timestamp, 10) * 1000,
  }), /RESEND_WEBHOOK_SIGNATURE_INVALID/);
});

test('Resend webhook route is explicit, verified, and canonical-ingestion only', () => {
  assert.match(route, /export async function POST/);
  assert.match(route, /request\.text\(\)/);
  assert.match(route, /verifyResendWebhookSignature/);
  assert.match(route, /svix-id/);
  assert.match(route, /svix-timestamp/);
  assert.match(route, /svix-signature/);
  assert.match(route, /requiredParam\(searchParams, 'tenantId'\)/);
  assert.match(route, /requiredParam\(searchParams, 'connectorKey'\)/);
  assert.match(route, /ingestVerifiedCommunicationProviderWebhook/);
  assert.doesNotMatch(route, /default-resend/);
  assert.doesNotMatch(route, /00000000-0000-0000-0000-000000000001/);
  assert.doesNotMatch(route, /ingestCommunicationProviderWebhook/);
  assert.doesNotMatch(route, /ResendWebhookNormalizer/);
});
