import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(
  new URL('../app/api/communications/providers/[key]/test-send/route.ts', import.meta.url),
  'utf8',
);

test('test-send uses governed credential lease paths and never resolves a secret directly', () => {
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /requireStepUp\(\)/);
  assert.match(route, /withTenantTransaction/);
  assert.match(route, /PostgresProviderRegistryRepository/);
  assert.match(route, /routePreparedCommunicationDispatch/);
  assert.match(route, /PostgresCommunicationSenderRepository/);
  assert.match(route, /platformFallback:\s*'DENY'/);
  assert.match(route, /PostgresConnectorCredentialRepository/);
  assert.match(route, /createGovernedCredentialLeaseRuntime/);
  assert.match(route, /governedResendApiTokenProvider/);
  assert.match(route, /governedTwilioCredentialsProvider/);
  assert.match(route, /delegatedSecretResolver/);
  assert.match(route, /new ResendEmailAdapter/);
  assert.match(route, /new TwilioSmsWhatsappAdapter/);
  assert.match(route, /new TwilioVoiceAdapter/);
  assert.doesNotMatch(route, /delegatedSecretResolver\.resolve/);
  assert.doesNotMatch(route, /VAULT_TOKEN|credential_ref\s*[:=]|Authorization:\s*['"]Bearer/);
});

test('test-send preserves the full registry connector for credential governance', () => {
  assert.match(route, /const selectedConnector = selected\[0\]!/);
  assert.match(route, /connector:\s*selectedConnector/);
  assert.doesNotMatch(route, /connector:\s*routed\.connector/);
});

test('test-send records real credential-lease evidence in the decision trace', () => {
  assert.match(route, /DecisionTraceBuilder/);
  assert.match(route, /pass\('CREDENTIAL_LEASE'/);
  assert.match(route, /TEST_SEND_OK/);
  assert.match(route, /INSERT INTO platform\.communication_decision_traces/);
  assert.match(route, /traceId:\s*trace\.traceId/);
  assert.match(route, /providerMessageId/);
});

test('test-send explicitly supports the certified provider targets only', () => {
  assert.match(route, /providerKey:\s*'resend'/);
  assert.match(route, /providerKey:\s*'twilio-sms'/);
  assert.match(route, /providerKey:\s*'twilio-whatsapp'/);
  assert.match(route, /providerKey:\s*'twilio-voice'/);
  assert.match(route, /communication\.email\.send/);
  assert.match(route, /communication\.sms\.send/);
  assert.match(route, /communication\.whatsapp\.send/);
  assert.match(route, /communication\.voice\.dial/);
});

test('test-send remains an explicit operator boundary with channel-specific validation', () => {
  assert.match(route, /triggerKey:\s*'communications\.test-send'/);
  assert.match(route, /Explicit step-up authenticated operator test send/);
  assert.match(route, /normalizeRecipient/);
  assert.match(route, /Twilio Voice test sends require an HTTPS TwiML voiceUrl/);
  assert.match(route, /platform-\$\{spec\.providerType\}-test-send/);
});
