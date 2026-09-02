import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../app/api/communications/domains/route.ts', import.meta.url), 'utf8');

test('sending-domain creation is admin gated and tenant scoped', () => {
  assert.match(route, /requireDomainAdmin/);
  assert.match(route, /PLATFORM_SUPER_ADMIN/);
  assert.match(route, /TENANT_ADMIN/);
  assert.match(route, /role\.ownership_scope = 'TENANT' AND role\.tenant_id = \$3::uuid/);
  assert.match(route, /Sending-domain administration is required/);
});

test('sending-domain creation validates domain-address ownership and defaults conservatively', () => {
  assert.match(route, /DOMAIN_RE\.test\(domain\)/);
  assert.match(route, /addressMatch\[1\]\?\.toLowerCase\(\) !== domain/);
  assert.match(route, /\['transactional'\] satisfies TenantPurpose\[\]/);
  assert.doesNotMatch(route, /ARRAY\['transactional','marketing','system'\]/);
  assert.doesNotMatch(route, /TENANT_PURPOSES = \['transactional', 'marketing', 'system'\]/);
});

test('default sender changes demote the previous active tenant default atomically', () => {
  assert.match(route, /SET is_default = false/);
  assert.match(route, /scope = 'TENANT'/);
  assert.match(route, /is_default = EXCLUDED\.is_default/);
});
