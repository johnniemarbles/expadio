import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeCommunicationProviderWebhook } from '../lib/communication-provider-webhook.ts';

const route = readFileSync(
  new URL('../app/api/webhooks/twilio/route.ts', import.meta.url),
  'utf8',
);

test('Twilio webhook route uses explicit tenancy and governed credential resolution', () => {
  assert.match(route, /requiredParam\(searchParams, 'tenantId'\)/);
  assert.match(route, /requiredParam\(searchParams, 'connectorKey'\)/);
  assert.match(route, /EXPADIO_COMMUNICATION_WORKER_SUBJECT_ID/);
  assert.match(route, /PostgresProviderRegistryRepository/);
  assert.match(route, /PostgresConnectorCredentialRepository/);
  assert.match(route, /createGovernedCredentialLeaseRuntime/);
  assert.match(route, /governedTwilioCredentialsProvider/);
  assert.match(route, /delegatedSecretResolver/);
  assert.doesNotMatch(route, /process\.env\.TWILIO_AUTH_TOKEN/);
  assert.doesNotMatch(route, /default-twilio/);
  assert.doesNotMatch(route, /00000000-0000-0000-0000-000000000001/);
});

test('Twilio webhook route verifies exact raw callback before canonical lifecycle ingestion', () => {
  assert.match(route, /request\.arrayBuffer\(\)/);
  assert.match(route, /x-twilio-signature/);
  assert.match(route, /getWebhookUrl:\s*\(\)\s*=>\s*request\.url/);
  assert.match(route, /TwilioWebhookNormalizer/);
  assert.match(route, /normalized\.verified/);
  assert.match(route, /ingestVerifiedCommunicationProviderWebhook/);
  assert.match(route, /event\.channel !== expectedChannel/);
  assert.doesNotMatch(route, /ingestCommunicationProviderWebhook/);
});

test('canonical webhook lifecycle recognizes Twilio delivery outcomes', () => {
  assert.equal(normalizeCommunicationProviderWebhook({
    providerKey: 'twilio-sms', eventType: 'SENT',
  }), 'SENT');
  assert.equal(normalizeCommunicationProviderWebhook({
    providerKey: 'twilio-whatsapp', eventType: 'DELIVERED',
  }), 'DELIVERED');
  assert.equal(normalizeCommunicationProviderWebhook({
    providerKey: 'twilio-voice', eventType: 'FAILED',
  }), 'FAILED');
  assert.equal(normalizeCommunicationProviderWebhook({
    providerKey: 'twilio-sms', eventType: 'QUEUED',
  }), 'IGNORED');
});
