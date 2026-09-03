import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canonicalCaptureSignaturePayload,
  captureLeadFields,
  verifyCaptureSignature,
} from '../lib/lead-capture-ingress.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const route = read('../app/api/lead-capture/ingest/[sourceId]/route.ts');
const migration = read('../../../infra/db/migrations/0126_governed_demand_capture_ingress.sql');

test('Ed25519 signatures cover timestamp plus exact raw body and expire', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const raw = new TextEncoder().encode('{"email":"lead@example.test"}');
  const timestamp = '1788372000';
  const signature = sign(null, canonicalCaptureSignaturePayload(timestamp, raw), privateKey).toString('base64');

  assert.equal(verifyCaptureSignature({
    publicKeyPem,
    signatureBase64: signature,
    timestamp,
    rawBody: raw,
    now: new Date(1788372000 * 1000 + 60_000),
    maxClockSkewSeconds: 300,
  }), true);
  assert.equal(verifyCaptureSignature({
    publicKeyPem,
    signatureBase64: signature,
    timestamp,
    rawBody: new TextEncoder().encode('{"email":"tampered@example.test"}'),
    now: new Date(1788372000 * 1000 + 60_000),
    maxClockSkewSeconds: 300,
  }), false);
  assert.throws(() => verifyCaptureSignature({
    publicKeyPem,
    signatureBase64: signature,
    timestamp,
    rawBody: raw,
    now: new Date(1788372000 * 1000 + 301_000),
    maxClockSkewSeconds: 300,
  }), /CAPTURE_SIGNATURE_EXPIRED/);
});

test('external payload contributes business data but not authority fields', () => {
  assert.deepEqual(captureLeadFields({
    title: '  Enquiry ',
    email: ' lead@example.test ',
    externalReference: ' form-123 ',
    organizationId: 'forged',
    stage: 'WON',
  }), {
    title: 'Enquiry',
    email: 'lead@example.test',
    externalReference: 'form-123',
  });
  assert.match(route, /'NEW_ENQUIRY', 'ACTIVE'/);
  assert.match(route, /source\.organizationId/);
  assert.doesNotMatch(route, /payload\.organizationId/);
  assert.doesNotMatch(route, /payload\.stage/);
  assert.doesNotMatch(route, /captureLayerId/);
});

test('public ingress requires source-bound signature, timestamp and idempotency', () => {
  assert.match(route, /CAPTURE_SIGNATURE_HEADER/);
  assert.match(route, /CAPTURE_TIMESTAMP_HEADER/);
  assert.match(route, /CAPTURE_IDEMPOTENCY_HEADER/);
  assert.match(route, /verifyCaptureSignature/);
  assert.match(route, /pg_advisory_xact_lock/);
  assert.match(route, /lead_capture_submissions/);
  assert.match(route, /replayed: true/);
});

test('database ingress policies are source-bound and signed-only', () => {
  assert.match(migration, /verification_algorithm text NOT NULL DEFAULT 'ED25519'/);
  assert.match(migration, /verification_public_key text/);
  assert.match(migration, /current_lead_capture_ingress_matches/);
  assert.match(migration, /require_signed_ticket = true/);
  assert.match(migration, /stage = 'NEW_ENQUIRY'/);
  assert.doesNotMatch(migration, /verification_private_key/);
  assert.doesNotMatch(migration, /shared_secret/);
});
