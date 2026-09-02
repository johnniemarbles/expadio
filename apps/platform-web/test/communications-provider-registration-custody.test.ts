import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const modal = read('../app/(shell)/communications/ProviderModal.tsx');
const custodyRoute = read('../app/api/custody/credentials/route.ts');
const custodyIntake = read('../../../packages/credential-custody/src/intake.ts');

test('provider modal BYOK registration receives the opaque custody reference it expects', () => {
  assert.match(modal, /intakeBody\.reference/);
  assert.match(custodyRoute, /reference:\s*result\.credentialRef/);
  assert.match(custodyRoute, /Cache-Control': 'no-store'/);
  assert.doesNotMatch(custodyRoute, /secret:\s*result/);
});

test('Twilio intake persists a runtime-capable vault bundle only after a successful probe', () => {
  assert.match(custodyIntake, /const result = await probe\.probe/);
  assert.match(custodyIntake, /if \(!result\.valid\)/);
  assert.match(custodyIntake, /runtimeCredentialPayload\(request\.providerKey, plaintext, request\.parameters\)/);
  assert.match(custodyIntake, /accountSid/);
  assert.match(custodyIntake, /authToken:\s*plaintextSecret/);
  assert.match(custodyIntake, /secret:\s*vaultSecret/);
  assert.match(custodyIntake, /zeroise\(vaultSecret\)/);
  assert.match(custodyIntake, /zeroise\(secret\)/);
});

test('Twilio companion account SID never becomes connector metadata', () => {
  assert.doesNotMatch(modal, /credentialRef:\s*accountSid/);
  assert.doesNotMatch(custodyRoute, /accountSid.*connector_credentials/s);
  assert.match(custodyRoute, /ALLOWED_PARAMETERS/);
});
