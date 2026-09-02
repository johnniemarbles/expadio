import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const setup = readFileSync(new URL('../app/api/communications/setup/state/route.ts', import.meta.url), 'utf8');

test('setup domain readiness uses the live sender verification source', () => {
  assert.match(setup, /FROM platform\.communication_sender_identities/);
  assert.match(setup, /verification_status = 'VERIFIED'/);
  assert.match(setup, /scope = 'TENANT'/);
  assert.match(setup, /channel = 'email'/);
  assert.match(setup, /count\(DISTINCT lower\(split_part\(address, '@', 2\)\)\)/);
});

test('setup does not treat the unwritten legacy sending-domain table as authoritative', () => {
  assert.doesNotMatch(setup, /FROM platform\.communication_sending_domains/);
});
