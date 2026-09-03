import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../app/api/communications/domains/cloudflare/route.ts', import.meta.url), 'utf8');
const modal = readFileSync(new URL('../app/(shell)/communications/DomainConfigModal.tsx', import.meta.url), 'utf8');
const governed = readFileSync(new URL('../lib/governed-cloudflare-dns.ts', import.meta.url), 'utf8');

test('Cloudflare DNS automation never accepts a browser or route env credential', () => {
  assert.match(route, /BROWSER_DNS_CREDENTIAL_FORBIDDEN/);
  assert.doesNotMatch(route, /process\.env\.CLOUDFLARE_API_TOKEN/);
  assert.doesNotMatch(route, /CLOUDFLARE_API_TOKEN/);
  assert.doesNotMatch(route, /body\.apiToken[^\n]*\|\|\s*process\.env/);
  assert.match(route, /resolveGovernedCloudflareDnsToken/);
});

test('Cloudflare DNS automation uses governed connector custody', () => {
  assert.match(governed, /CLOUDFLARE_DNS_CAPABILITY_KEY\s*=\s*'infrastructure\.dns\.configure'/);
  assert.match(governed, /PostgresProviderRegistryRepository/);
  assert.match(governed, /routeConnector/);
  assert.match(governed, /PostgresConnectorCredentialRepository/);
  assert.match(governed, /createGovernedCredentialLeaseRuntime/);
  assert.match(governed, /delegatedSecretResolver/);
  assert.match(governed, /providerKey\.trim\(\)\.toLowerCase\(\) === 'cloudflare'/);
});

test('domain UI does not collect or transport Cloudflare tokens', () => {
  assert.doesNotMatch(modal, /setApiToken/);
  assert.doesNotMatch(modal, /type="password"/);
  assert.doesNotMatch(modal, /apiToken:/);
  assert.match(modal, /governed DNS automation/);
  assert.match(modal, /JSON\.stringify\(\{ domain: normalizedDomain \}\)/);
});
