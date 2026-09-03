import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../app/api/communications/domains/cloudflare/route.ts', import.meta.url), 'utf8');
const modal = readFileSync(new URL('../app/(shell)/communications/DomainConfigModal.tsx', import.meta.url), 'utf8');

test('Cloudflare DNS automation never accepts a browser credential', () => {
  assert.match(route, /BROWSER_DNS_CREDENTIAL_FORBIDDEN/);
  assert.match(route, /process\.env\.CLOUDFLARE_API_TOKEN/);
  assert.doesNotMatch(route, /body\.apiToken[^\n]*\|\|\s*process\.env/);
});

test('domain UI does not collect or transport Cloudflare tokens', () => {
  assert.doesNotMatch(modal, /setApiToken/);
  assert.doesNotMatch(modal, /type="password"/);
  assert.doesNotMatch(modal, /apiToken:/);
  assert.match(modal, /deployment-held DNS automation only/);
  assert.match(modal, /JSON\.stringify\(\{ domain: normalizedDomain \}\)/);
});
