import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const matrix = readFileSync(new URL('../lib/communication-runtime-providers.ts', import.meta.url), 'utf8');
const collection = readFileSync(new URL('../app/api/communications/providers/route.ts', import.meta.url), 'utf8');
const item = readFileSync(new URL('../app/api/communications/providers/[key]/route.ts', import.meta.url), 'utf8');
const modal = readFileSync(new URL('../app/(shell)/communications/ProviderModal.tsx', import.meta.url), 'utf8');

test('executable provider matrix contains only providers wired into the governed runtime', () => {
  for (const provider of ['resend', 'twilio-sms', 'twilio-whatsapp', 'twilio-voice']) {
    assert.match(matrix, new RegExp(`providerKey: '${provider}'`));
  }
  for (const unsupported of ['sendgrid', 'postmark', 'mailgun', 'vonage-sms', 'messagebird-sms', '360dialog']) {
    assert.doesNotMatch(matrix, new RegExp(`providerKey: '${unsupported}'`));
  }
});

test('provider registration rejects catalog-only and credentialless runtime paths', () => {
  assert.match(collection, /executableCommunicationProvider\(providerKey, providerType\)/);
  assert.match(collection, /PROVIDER_RUNTIME_NOT_IMPLEMENTED/);
  assert.match(collection, /CUSTODY_RUNTIME_NOT_IMPLEMENTED/);
  assert.match(collection, /custodyMode === 'CUSTOMER_EGRESS'/);
  assert.match(collection, /capabilityKeys\.length !== 1/);
});

test('provider enable boundary cannot activate an unsupported connector', () => {
  assert.match(item, /requestedEnabled === true/);
  assert.match(item, /executableCommunicationProvider\(metadata\.provider_key, metadata\.provider_type\)/);
  assert.match(item, /PROVIDER_RUNTIME_NOT_IMPLEMENTED/);
});

test('provider modal exposes only executable providers and canonical custody references', () => {
  assert.match(modal, /EXECUTABLE_COMMUNICATION_PROVIDERS/);
  assert.match(modal, /intakeBody\.credentialRef/);
  assert.match(modal, /providerType:\s*selected\.providerType/);
  assert.match(modal, /capabilityKeys/);
  assert.doesNotMatch(modal, /\bcapabilities,\n/);
  assert.doesNotMatch(modal, /\["sendgrid"/);
  assert.doesNotMatch(modal, /CUSTOMER_EGRESS/);
});
