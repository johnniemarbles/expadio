import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  OTP_CAPABILITY_KEY,
  OTP_TRIGGER_KEY,
  buildOtpCommunicateIntent,
} from '../lib/lead-capture-otp-intent.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const input = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  captureLeadId: '33333333-3333-4333-8333-333333333333',
  recipientEmail: 'lead@example.com',
  code: '123456',
  now: new Date('2026-09-03T00:00:00.000Z'),
};

test('OTP intent is a transactional COMMUNICATE action carrying the code as a variable', () => {
  const intent = buildOtpCommunicateIntent(input);
  assert.equal(intent.executorClass, 'COMMUNICATE');
  assert.equal(intent.tenantId, input.tenantId);
  assert.equal(intent.aggregateId, input.captureLeadId);

  const config = intent.configuration as Record<string, unknown>;
  assert.equal(config.triggerKey, OTP_TRIGGER_KEY);
  assert.equal(config.capabilityKey, OTP_CAPABILITY_KEY);
  assert.equal(config.channel, 'email');
  assert.equal(config.purpose, 'transactional');
  assert.equal(config.consentRequired, false, 'transactional OTP does not require marketing consent');
  assert.equal(config.organizationId, input.organizationId);
  assert.deepEqual(config.recipient, { email: 'lead@example.com' });

  const variables = config.variables as Record<string, unknown>;
  assert.equal(variables.code, '123456');
  assert.equal(variables.ttlMinutes, 10);
});

test('OTP intent idempotency is deterministic per capture lead', () => {
  const a = buildOtpCommunicateIntent(input);
  const b = buildOtpCommunicateIntent(input);
  assert.equal(a.idempotencyKey, b.idempotencyKey);
  assert.equal(a.idempotencyKey, `lead-capture.otp:${input.captureLeadId}`);
});

test('the code appears ONLY inside variables, nowhere else in the intent', () => {
  const intent = buildOtpCommunicateIntent(input);
  const serialized = JSON.stringify({ ...intent, configuration: { ...intent.configuration, variables: undefined } });
  assert.doesNotMatch(serialized, /123456/, 'the code must not leak outside the variables bag');
});

test('delivery wires the governed fabric and never logs the code; template is seeded', () => {
  const delivery = read('../lib/lead-capture-otp-delivery.ts');
  const migration = read('../../../infra/db/migrations/0136_lead_capture_otp_template.sql');
  assert.match(delivery, /queueGovernedCommunicateAction/);
  assert.match(delivery, /PostgresCommunicationDeliveryRepository/);
  assert.match(delivery, /set_config\('app\.tenant_id'/);
  // Never throws to the caller (capture is already committed).
  assert.match(delivery, /best-effort/i);
  // Only reason codes / ids are logged, never the code or recipient.
  assert.doesNotMatch(delivery, /console\.[a-z]+\([^)]*\bcode\b/);
  assert.doesNotMatch(delivery, /console\.[a-z]+\([^)]*destination/);
  // Template renders the code variable with the mustache placeholder syntax.
  assert.match(migration, /trigger_key/);
  assert.match(migration, /\{\{code\}\}/);
  assert.match(migration, /'lead-capture\.otp'/);
  assert.match(migration, /'ACTIVE'/);
});
