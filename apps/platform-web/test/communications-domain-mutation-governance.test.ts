import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const verify = readFileSync(new URL('../app/api/communications/domains/[senderId]/verify/route.ts', import.meta.url), 'utf8');
const retire = readFileSync(new URL('../app/api/communications/domains/[senderId]/route.ts', import.meta.url), 'utf8');

test('domain verification is scope-aware and explicitly admin gated', () => {
  assert.match(verify, /requireCommunicationDomainAdmin/);
  assert.match(verify, /hasPlatformAdministrationRole/);
  assert.match(verify, /scope = 'PLATFORM'/);
  assert.match(verify, /scope IN \('TENANT','ORGANIZATION'\)/);
  assert.match(verify, /tenant_id = \$2::uuid/);
  assert.match(verify, /UUID_RE\.test\(senderId\)/);
});

test('domain verification cannot resurrect retired or suspended senders', () => {
  const activeChecks = verify.match(/status = 'ACTIVE'/g) ?? [];
  assert.ok(activeChecks.length >= 2, 'SELECT and UPDATE must both require ACTIVE state');
  assert.match(verify, /UPDATE platform\.communication_sender_identities/);
  assert.match(verify, /RETURNING sender_id/);
});

test('domain retirement supports tenant and organization identities without weakening platform ownership', () => {
  assert.match(retire, /requireCommunicationDomainAdmin/);
  assert.match(retire, /hasPlatformAdministrationRole/);
  assert.match(retire, /scope IN \('TENANT','ORGANIZATION'\)/);
  assert.match(retire, /scope = 'PLATFORM'/);
  assert.match(retire, /SET status = 'INACTIVE'/);
  assert.match(retire, /verification_status = 'REVOKED'/);
  assert.match(retire, /is_default = false/);
  assert.doesNotMatch(retire, /DELETE FROM platform\.communication_sender_identities/);
});

test('domain mutation routes reject malformed sender ids before UUID casts', () => {
  for (const source of [verify, retire]) {
    assert.match(source, /senderId must be a valid UUID/);
    assert.match(source, /status: 400/);
  }
});
