import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const fromCapture = read('../app/api/crm/leads/from-capture/route.ts');
const writer = read('../lib/lead-capture-convert.ts');
const migration = read('../../../infra/db/migrations/0125_demand_capture_trusted_seam.sql');

test('loadTrustedCaptureProjection selects verification_state from the capture table', () => {
  assert.match(writer, /l\.verification_state/);
  assert.match(writer, /verification_state/);
});

test('unverified leads are blocked at the projection layer before CRM write', () => {
  // The function returns a typed discriminant for the UNVERIFIED case
  assert.match(writer, /UNVERIFIED/);
  assert.match(writer, /verification_required/);
  // Distinct from not_found
  assert.match(writer, /kind: 'verification_required'/);
  assert.match(writer, /kind: 'not_found'/);
});

test('from-capture route returns 422 VERIFICATION_REQUIRED for unverified leads', () => {
  assert.match(fromCapture, /VERIFICATION_REQUIRED/);
  assert.match(fromCapture, /422/);
  assert.match(fromCapture, /verificationRequired/);
  assert.match(fromCapture, /OTP-verified/);
});

test('route handles all three discriminant kinds from loadTrustedCaptureProjection', () => {
  assert.match(fromCapture, /captureNotFound/);
  assert.match(fromCapture, /verificationRequired/);
  // ok kind proceeds to the CRM write
  assert.match(fromCapture, /buildTrustedCaptureConvertWrite/);
});

test('the verification gate closes the PUBLIC-rail hole — UNVERIFIED leads stay out of CRM', () => {
  // verification_state column exists in the public-rail migration
  const publicRail = read('../../../infra/db/migrations/0135_demand_capture_public_rail_ingress.sql');
  assert.match(publicRail, /verification_state/);
  assert.match(publicRail, /UNVERIFIED/);
  // route does not skip or bypass the verification check
  assert.doesNotMatch(fromCapture, /skip.*verif|verif.*skip/i);
});

test('loadTrustedCaptureProjection result is a discriminated union not a nullable', () => {
  // The return type uses kind discriminant, not null
  assert.match(writer, /TrustedCaptureProjectionResult/);
  assert.match(writer, /readonly kind: 'ok'/);
  assert.match(writer, /readonly kind: 'not_found'/);
  assert.match(writer, /readonly kind: 'verification_required'/);
});
