import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../../infra/db/migrations/0135_demand_capture_public_rail_ingress.sql');
const ingress = read('../app/api/lead-capture/public/[sourceId]/route.ts');
const verify = read('../app/api/lead-capture/public/[sourceId]/verify/route.ts');
const delivery = read('../lib/lead-capture-otp-delivery.ts');

test('public leads are parked UNVERIFIED and never enter the pipeline at ingest', () => {
  assert.match(migration, /verification_state text NOT NULL DEFAULT 'NOT_REQUIRED'/);
  assert.match(migration, /verification_state IN \('NOT_REQUIRED','UNVERIFIED','VERIFIED'\)/);
  // The public insert policy forces UNVERIFIED.
  assert.match(migration, /lead_capture_leads_public_ingress_insert[\s\S]*verification_state = 'UNVERIFIED'/);
  // The route inserts UNVERIFIED, not ACTIVE-in-pipeline.
  assert.match(ingress, /'NEW_ENQUIRY','ACTIVE','UNVERIFIED'/);
});

test('public ingress RLS is source-bound and rate events are append-only', () => {
  assert.match(migration, /current_lead_capture_public_ingress_matches/);
  assert.match(migration, /trust_rail = 'PUBLIC'/);
  assert.match(migration, /lead_capture_rate_events is append-only/);
  assert.match(migration, /lead_capture_rate_events_append_only/);
});

test('codes are stored only as a salted hash, never in plaintext', () => {
  assert.match(migration, /code_hash text NOT NULL/);
  assert.match(migration, /code_salt text NOT NULL/);
  assert.doesNotMatch(migration, /code_plaintext|plain_code|otp_code text/);
  // The ingress hashes before insert and never inserts the raw code.
  assert.match(ingress, /hashOtp\(code, salt\)/);
  assert.doesNotMatch(ingress, /code_hash[^)]*\bcode\b\s*\)/);
});

test('ingress enforces publishable key + origin and captures before parking', () => {
  assert.match(ingress, /checkKeyAndOrigin/);
  assert.match(ingress, /CAPTURE_PUBLISHABLE_KEY_HEADER/);
  assert.match(ingress, /evaluateRateLimit/);
  assert.match(ingress, /pg_advisory_xact_lock/);
  assert.match(ingress, /requiresVerification: true/);
  // Scope comes from the source row, never the request body.
  assert.match(ingress, /source\.organization_id/);
  assert.doesNotMatch(ingress, /body\.organizationId|payload\.organizationId|body\.tenantId/);
});

test('verify only promotes UNVERIFIED -> VERIFIED and cannot change scope/stage', () => {
  assert.match(verify, /evaluateOtpAttempt/);
  assert.match(verify, /verification_state='VERIFIED'[\s\S]*verification_state='UNVERIFIED'/);
  assert.match(verify, /FOR UPDATE/);
  assert.doesNotMatch(verify, /UPDATE platform\.lead_capture_leads[\s\S]*SET stage/);
});

test('OTP delivery seam never logs the plaintext code', () => {
  assert.doesNotMatch(delivery, /console\.[a-z]+\([^)]*code/);
});
