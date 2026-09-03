import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  OTP_SMS_CAPABILITY_KEY,
  OTP_SMS_TRIGGER_KEY,
  OTP_WHATSAPP_CAPABILITY_KEY,
  OTP_WHATSAPP_TRIGGER_KEY,
  buildSmsOtpCommunicateIntent,
} from '../lib/lead-capture-otp-intent.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const baseInput = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  captureLeadId: '33333333-3333-4333-8333-333333333333',
  recipientPhone: '+15551234567',
  code: '654321',
  now: new Date('2026-09-03T00:00:00.000Z'),
};

test('SMS intent routes to sms capability with phone recipient', () => {
  const intent = buildSmsOtpCommunicateIntent({ ...baseInput, channel: 'SMS' });
  assert.equal(intent.executorClass, 'COMMUNICATE');
  const config = intent.configuration as Record<string, unknown>;
  assert.equal(config.triggerKey, OTP_SMS_TRIGGER_KEY);
  assert.equal(config.capabilityKey, OTP_SMS_CAPABILITY_KEY);
  assert.equal(config.channel, 'sms');
  assert.equal(config.consentRequired, false);
  assert.deepEqual(config.recipient, { phone: '+15551234567' });
  const variables = config.variables as Record<string, unknown>;
  assert.equal(variables.code, '654321');
  assert.equal(variables.ttlMinutes, 10);
});

test('WhatsApp intent routes to whatsapp capability', () => {
  const intent = buildSmsOtpCommunicateIntent({ ...baseInput, channel: 'WHATSAPP' });
  const config = intent.configuration as Record<string, unknown>;
  assert.equal(config.triggerKey, OTP_WHATSAPP_TRIGGER_KEY);
  assert.equal(config.capabilityKey, OTP_WHATSAPP_CAPABILITY_KEY);
  assert.equal(config.channel, 'whatsapp');
  assert.deepEqual(config.recipient, { phone: '+15551234567' });
});

test('SMS and WhatsApp intents have distinct idempotency keys per capture lead', () => {
  const sms = buildSmsOtpCommunicateIntent({ ...baseInput, channel: 'SMS' });
  const wa = buildSmsOtpCommunicateIntent({ ...baseInput, channel: 'WHATSAPP' });
  assert.notEqual(sms.idempotencyKey, wa.idempotencyKey);
  assert.match(sms.idempotencyKey, /lead-capture\.otp\.sms:/);
  assert.match(wa.idempotencyKey, /lead-capture\.otp\.whatsapp:/);
});

test('the code appears ONLY inside variables in the SMS intent', () => {
  const intent = buildSmsOtpCommunicateIntent({ ...baseInput, channel: 'SMS' });
  const stripped = JSON.stringify({ ...intent, configuration: { ...intent.configuration, variables: undefined } });
  assert.doesNotMatch(stripped, /654321/, 'code must not leak outside the variables bag');
});

test('delivery routes SMS and WhatsApp through the governed fabric, not the email path', () => {
  const delivery = read('../lib/lead-capture-otp-delivery.ts');
  assert.match(delivery, /OTP_SMS_CAPABILITY_KEY/);
  assert.match(delivery, /OTP_WHATSAPP_CAPABILITY_KEY/);
  assert.match(delivery, /buildSmsOtpCommunicateIntent/);
  // No longer unconditionally falls through to CHANNEL_UNSUPPORTED
  assert.doesNotMatch(delivery, /CHANNEL_UNSUPPORTED/);
  // Channel selection drives the capability key
  assert.match(delivery, /channel.*SMS.*OTP_SMS_CAPABILITY_KEY|OTP_SMS_CAPABILITY_KEY.*SMS/s);
});

test('SMS and WhatsApp OTP templates are seeded in the migration', () => {
  const migration = read('../../../infra/db/migrations/0149_lead_capture_otp_sms_template.sql');
  assert.match(migration, /'lead-capture\.otp\.sms'/);
  assert.match(migration, /'lead-capture\.otp\.whatsapp'/);
  assert.match(migration, /\{\{code\}\}/);
  assert.match(migration, /\{\{ttlMinutes\}\}/);
  // Idempotent: does not clobber existing rows
  assert.match(migration, /WHERE NOT EXISTS/);
  // Text format for SMS carrier compatibility
  assert.match(migration, /'TEXT'/);
});

test('delivery never logs the plaintext code or phone number', () => {
  const delivery = read('../lib/lead-capture-otp-delivery.ts');
  assert.doesNotMatch(delivery, /console\.[a-z]+\([^)]*\bcode\b/);
  assert.doesNotMatch(delivery, /console\.[a-z]+\([^)]*destination/);
  assert.doesNotMatch(delivery, /console\.[a-z]+\([^)]*recipientPhone/);
});
