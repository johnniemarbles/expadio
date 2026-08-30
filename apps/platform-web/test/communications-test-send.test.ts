import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(
  new URL('../app/api/communications/providers/[key]/test-send/route.ts', import.meta.url),
  'utf8',
);

test('Resend test-send route uses governed existing boundaries and discloses no secret', () => {
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /requireStepUp\(\)/);
  assert.match(route, /withTenantTransaction/);
  assert.match(route, /PostgresProviderRegistryRepository/);
  assert.match(route, /routePreparedCommunicationDispatch/);
  assert.match(route, /PostgresCommunicationSenderRepository/);
  assert.match(route, /platformFallback:\s*'DENY'/);
  assert.match(route, /PostgresConnectorCredentialRepository/);
  assert.match(route, /delegatedSecretResolver\.resolve\(credentialReference\)/);
  assert.match(route, /new ResendEmailAdapter/);
  assert.match(route, /providerKey !== 'resend'/);
  assert.doesNotMatch(route, /VAULT_TOKEN|credential_ref\s*[:=]|Authorization:\s*['"]Bearer/);
});

test('test-send is explicitly test-only rather than production-dispatch masquerading', () => {
  assert.match(route, /triggerKey:\s*'communications\.test-send'/);
  assert.match(route, /Explicit step-up authenticated operator test send/);
  assert.match(route, /platform-test-send/);
  assert.doesNotMatch(route, /runEnforcementSpine/);
  assert.doesNotMatch(route, /GovernedCredentialLeaseService/);
});


test('accepted test send records an append-only decision trace inside the tenant transaction', () => {
  assert.match(route, /DecisionTraceBuilder/);
  assert.match(route, /TEST_SEND_OK/);
  assert.match(route, /INSERT INTO platform\.communication_decision_traces/);
  assert.match(route, /connectors_considered/);
  assert.match(route, /traceId:\s*trace\.traceId/);
  // This test-only path must not claim the production credential-lease gate passed.
  assert.doesNotMatch(route, /pass\('CREDENTIAL_LEASE'/);
});
