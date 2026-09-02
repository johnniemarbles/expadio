import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../app/api/communications/domains/[senderId]/verify/route.ts', import.meta.url), 'utf8');

test('domain verification is admin gated, UUID validated, and cannot mutate platform senders', () => {
  assert.match(route, /requireCommunicationDomainAdmin/);
  assert.match(route, /UUID_RE\.test\(senderId\)/);
  assert.match(route, /scope IN \('TENANT', 'ORGANIZATION'\)/);
  assert.doesNotMatch(route, /scope = 'PLATFORM' OR tenant_id/);
});

test('VERIFIED requires both live DNS and governed provider evidence', () => {
  assert.match(route, /const nextStatus = dnsVerified && provider\.ok \? 'VERIFIED' : 'PENDING'/);
  assert.match(route, /governedResendApiTokenProvider/);
  assert.match(route, /https:\/\/api\.resend\.com\/domains/);
  assert.match(route, /sendingCapability === 'enabled'/);
  assert.match(route, /providerStatus === 'verified'/);
});

test('raw provider credentials are never sourced from environment or request input', () => {
  assert.doesNotMatch(route, /RESEND_API_KEY/);
  assert.doesNotMatch(route, /process\.env/);
  assert.match(route, /PostgresConnectorCredentialRepository/);
  assert.match(route, /createGovernedCredentialLeaseRuntime/);
  assert.match(route, /delegatedSecretResolver/);
});
