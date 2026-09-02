import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manual = readFileSync(new URL('../app/api/communications/domains/route.ts', import.meta.url), 'utf8');
const cloudflare = readFileSync(new URL('../app/api/communications/domains/cloudflare/route.ts', import.meta.url), 'utf8');
const guard = readFileSync(new URL('../lib/communication-domain-admin.ts', import.meta.url), 'utf8');

test('sending-domain creation is admin gated and tenant scoped', () => {
  assert.match(manual, /requireCommunicationDomainAdmin/);
  assert.match(cloudflare, /requireCommunicationDomainAdmin/);
  assert.match(guard, /PLATFORM_SUPER_ADMIN/);
  assert.match(guard, /TENANT_ADMIN/);
  assert.match(guard, /role\.ownership_scope = 'TENANT' AND role\.tenant_id = \$3::uuid/);
  assert.match(manual, /Sending-domain administration is required/);
  assert.match(cloudflare, /Sending-domain administration is required/);
});

test('Cloudflare authorization happens before token use or provider calls', () => {
  const authorizationIndex = cloudflare.indexOf('const authorized = await withTenantClient');
  const tokenIndex = cloudflare.indexOf('const token =');
  const providerIndex = cloudflare.indexOf('findZone(token, domain)');
  assert.ok(authorizationIndex >= 0 && tokenIndex > authorizationIndex && providerIndex > authorizationIndex);
});

test('sending-domain creation validates domain-address ownership and defaults conservatively', () => {
  assert.match(manual, /DOMAIN_RE\.test\(domain\)/);
  assert.match(manual, /addressMatch\[1\]\?\.toLowerCase\(\) !== domain/);
  assert.match(manual, /\['transactional'\] satisfies TenantPurpose\[\]/);
  assert.doesNotMatch(manual, /ARRAY\['transactional','marketing','system'\]/);
  assert.doesNotMatch(cloudflare, /ARRAY\['transactional','marketing','system'\]/);
  assert.match(cloudflare, /ARRAY\['transactional'\], false, 'PENDING'/);
});

test('default sender changes demote the previous active tenant default atomically', () => {
  assert.match(manual, /SET is_default = false/);
  assert.match(manual, /scope = 'TENANT'/);
  assert.match(manual, /is_default = EXCLUDED\.is_default/);
});
