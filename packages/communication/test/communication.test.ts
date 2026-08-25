import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CommunicationIntentError,
  communicationChannelMetadata,
  communicationRecipientKey,
  inferDefaultCommunicationChannel,
  listCommunicationChannels,
  recipientSupportsChannel,
  validateCommunicationIntent,
  type CommunicationIntent,
} from '../src/index.ts';

function intent(overrides: Partial<CommunicationIntent> = {}): CommunicationIntent {
  return {
    triggerKey: 'lead.followup',
    tenantId: 'tenant-a',
    organizationId: 'org-a',
    recipient: { email: ' Person@Example.COM ' },
    variables: {},
    idempotencyKey: 'message-1',
    purpose: 'transactional',
    consentRequired: false,
    ...overrides,
  };
}

test('communication channel registry preserves consent and suppression semantics', () => {
  assert.equal(communicationChannelMetadata('voice').requiresConsent, true);
  assert.equal(communicationChannelMetadata('voice').supportsSuppression, true);
  assert.equal(communicationChannelMetadata('email').supportsSuppression, true);
  assert.equal(communicationChannelMetadata('in_app').supportsSuppression, false);
  assert.equal(listCommunicationChannels().length, 7);
});

test('recipient capability is channel-specific', () => {
  const recipient = {
    subjectId: 'subject-1',
    email: 'person@example.com',
    phone: '+14165551234',
  };

  assert.equal(recipientSupportsChannel(recipient, 'email'), true);
  assert.equal(recipientSupportsChannel(recipient, 'sms'), true);
  assert.equal(recipientSupportsChannel(recipient, 'voice'), true);
  assert.equal(recipientSupportsChannel(recipient, 'whatsapp'), true);
  assert.equal(recipientSupportsChannel(recipient, 'in_app'), true);
  assert.equal(recipientSupportsChannel(recipient, 'push'), true);
  assert.equal(recipientSupportsChannel(recipient, 'rcs'), true);
});

test('recipient capability fails closed when required addressing is absent', () => {
  const recipient = { email: 'person@example.com' };

  assert.equal(recipientSupportsChannel(recipient, 'email'), true);
  assert.equal(recipientSupportsChannel(recipient, 'voice'), false);
  assert.equal(recipientSupportsChannel(recipient, 'in_app'), false);
  assert.equal(recipientSupportsChannel(recipient, 'push'), false);
});

test('marketing intent requires explicit consent enforcement', () => {
  assert.throws(
    () => validateCommunicationIntent(intent({ purpose: 'marketing', consentRequired: false })),
    (error: unknown) =>
      error instanceof CommunicationIntentError &&
      error.code === 'MARKETING_CONSENT_REQUIRED',
  );
});

test('idempotency key is mandatory before dispatch orchestration', () => {
  assert.throws(
    () => validateCommunicationIntent(intent({ idempotencyKey: '   ' })),
    (error: unknown) =>
      error instanceof CommunicationIntentError && error.code === 'IDEMPOTENCY_REQUIRED',
  );
});

test('default inference is deterministic and never guesses voice, RCS or push', () => {
  assert.equal(
    inferDefaultCommunicationChannel({ email: 'person@example.com', whatsapp: '+1', phone: '+2' }),
    'email',
  );
  assert.equal(inferDefaultCommunicationChannel({ whatsapp: '+1', phone: '+2' }), 'whatsapp');
  assert.equal(inferDefaultCommunicationChannel({ phone: '+2' }), 'sms');
  assert.equal(inferDefaultCommunicationChannel({ subjectId: 'subject-1' }), 'in_app');
});

test('validated intent returns a normalized stable recipient key', () => {
  const validated = validateCommunicationIntent(intent());
  assert.equal(validated.channel, 'email');
  assert.equal(validated.recipientKey, 'person@example.com');
  assert.equal(
    communicationRecipientKey({ phone: ' +14165551234 ' }, 'voice'),
    '+14165551234',
  );
});

test('explicit channel fails closed when recipient cannot address it', () => {
  assert.throws(
    () => validateCommunicationIntent(intent({ channel: 'voice' })),
    (error: unknown) =>
      error instanceof CommunicationIntentError && error.code === 'CHANNEL_RECIPIENT_MISMATCH',
  );
});
