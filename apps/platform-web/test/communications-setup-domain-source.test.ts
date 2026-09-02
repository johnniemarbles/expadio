import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../app/api/communications/setup/state/route.ts', import.meta.url), 'utf8');

test('setup domain readiness uses dispatch sender verification state', () => {
  assert.match(route, /FROM platform\.communication_sender_identities/);
  assert.match(route, /verification_status = 'VERIFIED'/);
  assert.match(route, /scope = 'TENANT'/);
  assert.match(route, /channel = 'email'/);
  assert.doesNotMatch(route, /FROM platform\.communication_sending_domains/);
});

test('setup sender counts only active identities', () => {
  assert.match(route, /WHERE tenant_id = \$1::uuid\s+AND status = 'ACTIVE'/s);
});
