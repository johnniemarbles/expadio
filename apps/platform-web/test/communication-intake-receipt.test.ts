import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { consumeIntakeReceipt, intakeProviderKey, IntakeReceiptRequired } from '../lib/communication-intake-receipt.ts';

test('invalid receipt identifiers fail before database work', async () => {
  const client = { async query() { throw new Error('must not query'); } };
  for (const receiptId of [undefined, null, '', {}, 'not-a-uuid']) {
    await assert.rejects(consumeIntakeReceipt(client, { receiptId, tenantId: '', subjectId: '', connectorKey: '', providerKey: '', credentialRef: '' }), IntakeReceiptRequired);
  }
});

test('provider aliases match the intake probe without collapsing unrelated providers', () => {
  assert.equal(intakeProviderKey('twilio-whatsapp'), 'twilio');
  assert.equal(intakeProviderKey('vonage-voice'), 'vonage');
  assert.equal(intakeProviderKey('resend'), 'resend');
  assert.equal(intakeProviderKey('twilio-unknown'), 'twilio-unknown');
});

test('registration uses server evidence and activation cannot write its own health', () => {
  const registration = readFileSync(new URL('../app/api/communications/providers/route.ts', import.meta.url), 'utf8');
  assert.match(registration, /await consumeIntakeReceipt/);
  assert.doesNotMatch(registration, /body\.(fingerprint|keyVersion|probeWarnings|detectedCapabilities)/);
  assert.match(registration, /receipt\.probed_at/);
  const activation = readFileSync(new URL('../app/api/communications/providers/[key]/route.ts', import.meta.url), 'utf8');
  assert.match(activation, /typeof enabled !== 'boolean'/);
  assert.match(activation, /health !== undefined/);
  assert.match(activation, /intake_receipt_id IS NOT NULL/);
  assert.match(activation, /DELIVERY_ADAPTER_UNAVAILABLE/);
  assert.match(activation, /severity.*BLOCKING/);
});
