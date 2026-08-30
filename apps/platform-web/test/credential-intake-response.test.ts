import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { credentialReferenceFromIntake } from '../lib/credential-intake-response.ts';

const credentialRef = 'vault://tenant/00000000-0000-0000-0000-000000000001/connector/platform-resend/v1';

test('reads the custody service credentialRef field, not reference', () => {
  assert.equal(credentialReferenceFromIntake({ probeStatus: 'VALID', credentialRef }), credentialRef);
});

for (const [name, response] of [
  ['old incorrect field', { probeStatus: 'VALID', reference: credentialRef }],
  ['failed probe', { probeStatus: 'INVALID', credentialRef }],
  ['missing probe', { credentialRef }],
  ['plaintext instead of reference', { probeStatus: 'VALID', credentialRef: 'raw-token' }],
  ['empty reference', { probeStatus: 'VALID', credentialRef: '' }],
  ['oversized reference', { probeStatus: 'VALID', credentialRef: 'vault://' + 'x'.repeat(512) }],
  ['null', null],
  ['array', []],
] as const) {
  test(`rejects ${name} before registration`, () => {
    assert.throws(() => credentialReferenceFromIntake(response), /Registration was not attempted/);
  });
}

test('provider UI validates intake before returning a registration reference', () => {
  const modal = readFileSync(new URL('../app/(shell)/communications/ProviderModal.tsx', import.meta.url), 'utf8');
  assert.match(modal, /credentialReferenceFromIntake\(intakeBody\)/);
  assert.doesNotMatch(modal, /intakeBody\.reference/);
  assert.match(modal, /reference: credentialRef/);
});
