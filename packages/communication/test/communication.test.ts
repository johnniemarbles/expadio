import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CommunicationContractError,
  deriveRecipientKey,
  inferDefaultChannel,
  validateCommunicationRequest,
  type CommunicationSendRequest,
} from '../src/index.ts';

function baseRequest(overrides: Partial<CommunicationSendRequest> = {}): CommunicationSendRequest {
  return {
    triggerKey: 'lead.followup',
    tenantId: 'tenant-a',
    organizationId: 'org-a',
    recipient: { email: ' Person@Example.COM ' },
    variables: {},
    idempotencyKey: 'msg-1',
    purpose: 'transactional',
    consentRequired: false,
    ...overrides,
  };
}

test('marketing communication requires explicit consent enforcement', () => {
  assert.throws(
    () => validateCommunicationRequest(baseRequest({ purpose: 'marketing', consentRequired: false })),
    (error: unknown) =>
      error instanceof CommunicationContractError &&
      error.code === 'MARKETING_CONSENT_REQUIRED',
  );
});

test('explicit channel must be compatible with the recipient', () => {
  assert.throws(
    () => validateCommunicationRequest(baseRequest({ channel: 'voice' })),
    (error: unknown) =>
      error instanceof CommunicationContractError &&
      error.code === 'CHANNEL_RECIPIENT_MISMATCH',
  );
});

test('default routing preserves email then whatsapp then sms precedence', () => {
  assert.equal(
    inferDefaultChannel({ email: 'person@example.com', whatsapp: '+15550001', phone: '+15550002' }),
    'email',
  );
  assert.equal(inferDefaultChannel({ whatsapp: '+15550001', phone: '+15550002' }), 'whatsapp');
  assert.equal(inferDefaultChannel({ phone: '+15550002' }), 'sms');
  assert.equal(inferDefaultChannel({ subjectId: 'subject-1' }), 'in_app');
});

test('recipient keys are stable and provider-neutral', () => {
  assert.equal(deriveRecipientKey({ email: ' Person@Example.COM ' }, 'email'), 'person@example.com');
  assert.equal(deriveRecipientKey({ phone: ' +15550002 ' }, 'voice'), '+15550002');
  assert.equal(deriveRecipientKey({ subjectId: 'subject-1' }, 'push'), 'subject-1');
});

test('push endpoint is an opaque EXPADIO identifier rather than a provider token contract', () => {
  const request = baseRequest({
    channel: 'push',
    recipient: { subjectId: 'subject-1', pushEndpointId: 'endpoint-9' },
  });

  validateCommunicationRequest(request);
  assert.equal(deriveRecipientKey(request.recipient, 'push'), 'endpoint-9');
});

test('idempotency key is mandatory before dispatch', () => {
  assert.throws(
    () => validateCommunicationRequest(baseRequest({ idempotencyKey: '   ' })),
    (error: unknown) =>
      error instanceof CommunicationContractError && error.code === 'IDEMPOTENCY_REQUIRED',
  );
});
