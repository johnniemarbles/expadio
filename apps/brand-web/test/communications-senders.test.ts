import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const collection = readFileSync(new URL('../app/api/communications/senders/route.ts', import.meta.url), 'utf8');
const item = readFileSync(new URL('../app/api/communications/senders/[senderId]/route.ts', import.meta.url), 'utf8');

test('Brand sender management is organization scoped and governance gated', () => {
  assert.match(collection, /scope = 'ORGANIZATION'/);
  assert.match(collection, /organization_id = \$2::uuid/);
  assert.match(collection, /hasBrandGovernanceForOrganization/);
  assert.match(item, /organization_id = \$3::uuid/);
  assert.match(item, /hasBrandGovernanceForOrganization/);
});

test('Brand-created email senders start pending and non-default', () => {
  assert.match(collection, /false, false, 'PENDING', 'ACTIVE'/);
  assert.doesNotMatch(collection, /'VERIFIED', 'ACTIVE'/);
  assert.doesNotMatch(collection, /is_default[^\n]*true/);
  assert.doesNotMatch(collection, /is_system_fallback[^\n]*true/);
});

test('Brand sender purposes exclude system and require address-domain ownership', () => {
  assert.match(collection, /PURPOSES = \['transactional', 'marketing'\]/);
  assert.doesNotMatch(collection, /PURPOSES = \['transactional', 'marketing', 'system'\]/);
  assert.match(collection, /addressMatch\[1\]\?\.toLowerCase\(\) !== domain/);
});

test('Brand retirement validates identifiers and preserves sender evidence', () => {
  assert.match(item, /UUID_RE\.test\(senderId\)/);
  assert.match(item, /senderId must be a valid UUID/);
  assert.match(item, /status: 400/);
  assert.match(item, /SET status = 'INACTIVE', is_default = false/);
  assert.doesNotMatch(item, /DELETE FROM platform\.communication_sender_identities/);
});
