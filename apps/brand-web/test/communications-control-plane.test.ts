import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
const projection=read('../lib/brand-communications.ts');
const route=read('../app/api/communications/overview/route.ts');
const page=read('../app/(workspace)/communications/page.tsx');
const shell=read('../components/BrandShellFrame.tsx');

test('Brand Communications is a real organization-scoped workspace surface',()=>{
  assert.match(shell,/href="\/communications"/);
  assert.match(page,/loadBrandCommunicationOverview/);
  assert.match(route,/resolveBrandContext/);
  assert.match(route,/withBrandTransaction/);
  assert.match(projection,/organization_id = \$2::uuid/);
  assert.match(projection,/tenant_id = \$1::uuid/);
});

test('Brand Communications remains credential and provider-control blind',()=>{
  for(const source of [projection,route,page]){
    assert.doesNotMatch(source,/credential[_A-Za-z]|credentialRef|credential_state/);
    assert.doesNotMatch(source,/secretResolver|custody|wrapping-key|authToken|apiKey/);
    assert.doesNotMatch(source,/provider_registry|provider-registry|connector_credentials/);
  }
  assert.doesNotMatch(projection,/connector_key/);
  assert.doesNotMatch(projection,/communication_provider_attempts/);
  assert.doesNotMatch(projection,/communication_provider_webhook_events/);
  assert.doesNotMatch(route,/POST|PATCH|PUT|DELETE/);
});

test('Brand overview exposes business lifecycle and inherited readiness only',()=>{
  assert.match(projection,/communication_deliveries/);
  assert.match(projection,/communication_templates/);
  assert.match(projection,/communication_sender_identities/);
  assert.match(projection,/communication_suppressions/);
  assert.match(page,/Delivery infrastructure and platform suppression governance remain Platform-owned/);
  assert.match(page,/infrastructure configuration is not exposed here/);
  assert.match(page,/Organization-scoped/);
});
