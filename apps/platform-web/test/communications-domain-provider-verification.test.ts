import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const verify = readFileSync(new URL('../app/api/communications/domains/[senderId]/verify/route.ts', import.meta.url), 'utf8');
const retire = readFileSync(new URL('../app/api/communications/domains/[senderId]/route.ts', import.meta.url), 'utf8');

test('domain verification is admin gated, UUID validated, and cannot mutate platform senders', () => {
  assert.match(verify, /requireCommunicationDomainAdmin/);
  assert.match(verify, /UUID_RE\.test\(senderId\)/);
  assert.match(verify, /scope IN \('TENANT', 'ORGANIZATION'\)/);
  assert.doesNotMatch(verify, /scope = 'PLATFORM' OR tenant_id/);
});

test('VERIFIED requires both live DNS and governed provider evidence', () => {
  assert.match(verify, /const nextStatus = dnsVerified && provider\.ok \? 'VERIFIED' : 'PENDING'/);
  assert.match(verify, /governedResendApiTokenProvider/);
  assert.match(verify, /https:\/\/api\.resend\.com\/domains/);
  assert.match(verify, /sendingCapability === 'enabled'/);
  assert.match(verify, /providerStatus === 'verified'/);
});

test('raw provider credentials are never sourced from environment or request input', () => {
  assert.doesNotMatch(verify, /RESEND_API_KEY/);
  assert.doesNotMatch(verify, /process\.env/);
  assert.match(verify, /PostgresConnectorCredentialRepository/);
  assert.match(verify, /createGovernedCredentialLeaseRuntime/);
  assert.match(verify, /delegatedSecretResolver/);
});

test('tenant domain retirement is admin gated, soft, and platform-read-only', () => {
  assert.match(retire, /requireCommunicationDomainAdmin/);
  assert.match(retire, /UUID_RE\.test\(senderId\)/);
  assert.match(retire, /scope IN \('TENANT', 'ORGANIZATION'\)/);
  assert.match(retire, /SET status = 'INACTIVE'/);
  assert.match(retire, /verification_status = 'REVOKED'/);
  assert.match(retire, /is_default = false/);
  assert.doesNotMatch(retire, /scope = 'PLATFORM'/);
  assert.doesNotMatch(retire, /DELETE FROM platform\.communication_sender_identities/);
});
