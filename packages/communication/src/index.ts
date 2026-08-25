export type CommunicationChannel =
  | 'email'
  | 'sms'
  | 'whatsapp'
  | 'voice'
  | 'in_app'
  | 'push'
  | 'rcs';

export type CommunicationPurpose = 'transactional' | 'marketing' | 'system';

export type CommunicationAddressKind = 'email' | 'phone' | 'whatsapp' | 'subject' | 'push';

export interface CommunicationChannelMetadata {
  readonly channel: CommunicationChannel;
  readonly addressKind: CommunicationAddressKind;
  readonly requiresConsent: boolean;
  readonly supportsSuppression: boolean;
}

const CHANNELS: Readonly<Record<CommunicationChannel, CommunicationChannelMetadata>> = {
  email: { channel: 'email', addressKind: 'email', requiresConsent: false, supportsSuppression: true },
  sms: { channel: 'sms', addressKind: 'phone', requiresConsent: true, supportsSuppression: true },
  whatsapp: { channel: 'whatsapp', addressKind: 'whatsapp', requiresConsent: true, supportsSuppression: true },
  voice: { channel: 'voice', addressKind: 'phone', requiresConsent: true, supportsSuppression: true },
  in_app: { channel: 'in_app', addressKind: 'subject', requiresConsent: false, supportsSuppression: false },
  push: { channel: 'push', addressKind: 'push', requiresConsent: true, supportsSuppression: true },
  rcs: { channel: 'rcs', addressKind: 'phone', requiresConsent: true, supportsSuppression: true },
};

export function communicationChannelMetadata(channel: CommunicationChannel): CommunicationChannelMetadata {
  return CHANNELS[channel];
}

export function listCommunicationChannels(): readonly CommunicationChannelMetadata[] {
  return Object.values(CHANNELS);
}

export interface CommunicationRecipient {
  readonly subjectId?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly whatsapp?: string;
  readonly pushEndpoint?: string;
}

export interface CommunicationIntent {
  readonly triggerKey: string;
  readonly tenantId: string;
  readonly organizationId?: string;
  readonly recipient: CommunicationRecipient;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly locale?: string;
  readonly idempotencyKey: string;
  readonly purpose: CommunicationPurpose;
  readonly consentRequired: boolean;
  readonly channel?: CommunicationChannel;
}

export type CommunicationDispatchState = 'QUEUED' | 'SENT' | 'REFUSED';

export type CommunicationDispatchReasonCode =
  | 'OK'
  | 'CONSENT_MISSING'
  | 'SUPPRESSED'
  | 'PROVIDER_UNAVAILABLE'
  | 'TEMPLATE_MISSING'
  | 'RATE_LIMITED'
  | 'RESIDENCY_BLOCKED'
  | 'SENDER_UNVERIFIED'
  | 'QUIET_HOURS'
  | 'THROTTLED'
  | 'GOVERNANCE_BLOCKED'
  | 'NOT_CONFIGURED'
  | 'INVALID_RECIPIENT';

export interface CommunicationDispatchResult {
  readonly state: CommunicationDispatchState;
  readonly reasonCode: CommunicationDispatchReasonCode;
  readonly messageId: string | null;
  readonly providerKey?: string;
  readonly refusalReason?: string;
  readonly queuedAt?: string;
}

export type CommunicationDeliveryStatus =
  | 'QUEUED'
  | 'SENT'
  | 'DELIVERED'
  | 'FAILED'
  | 'BOUNCED'
  | 'COMPLAINED'
  | 'READ'
  | 'CANCELLED'
  | 'UNKNOWN';

export interface CommunicationDeliveryUpdate {
  readonly messageId: string;
  readonly channel: CommunicationChannel;
  readonly status: CommunicationDeliveryStatus;
  readonly occurredAt: string;
  readonly providerKey?: string;
  readonly providerMessageId?: string;
  readonly reasonCode?: string;
}

export type CommunicationIntentErrorCode =
  | 'TRIGGER_REQUIRED'
  | 'TENANT_REQUIRED'
  | 'IDEMPOTENCY_REQUIRED'
  | 'MARKETING_CONSENT_REQUIRED'
  | 'RECIPIENT_REQUIRED'
  | 'CHANNEL_RECIPIENT_MISMATCH';

export class CommunicationIntentError extends Error {
  constructor(
    readonly code: CommunicationIntentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CommunicationIntentError';
  }
}

export interface ValidatedCommunicationIntent {
  readonly intent: CommunicationIntent;
  readonly channel: CommunicationChannel;
  readonly recipientKey: string;
}

/**
 * Validates domain-level invariants before templates, suppression, routing or
 * provider selection run. This is intentionally provider-neutral.
 */
export function validateCommunicationIntent(intent: CommunicationIntent): ValidatedCommunicationIntent {
  if (!nonBlank(intent.triggerKey)) {
    throw new CommunicationIntentError('TRIGGER_REQUIRED', 'triggerKey is required.');
  }
  if (!nonBlank(intent.tenantId)) {
    throw new CommunicationIntentError('TENANT_REQUIRED', 'tenantId is required.');
  }
  if (!nonBlank(intent.idempotencyKey)) {
    throw new CommunicationIntentError('IDEMPOTENCY_REQUIRED', 'idempotencyKey is required.');
  }
  if (intent.purpose === 'marketing' && intent.consentRequired !== true) {
    throw new CommunicationIntentError(
      'MARKETING_CONSENT_REQUIRED',
      'Marketing communication requires consentRequired=true.',
    );
  }

  const channel = intent.channel ?? inferDefaultCommunicationChannel(intent.recipient);
  if (channel === null) {
    throw new CommunicationIntentError('RECIPIENT_REQUIRED', 'Recipient has no routable address.');
  }
  if (!recipientSupportsChannel(intent.recipient, channel)) {
    throw new CommunicationIntentError(
      'CHANNEL_RECIPIENT_MISMATCH',
      `Recipient does not support communication channel ${channel}.`,
    );
  }

  return {
    intent,
    channel,
    recipientKey: communicationRecipientKey(intent.recipient, channel),
  };
}

/**
 * Deterministic default preserves BEMP's email -> WhatsApp -> SMS precedence.
 * Subject-only recipients resolve to in-app; voice/RCS/push require explicit
 * policy/routing selection and are never guessed from a shared address.
 */
export function inferDefaultCommunicationChannel(
  recipient: CommunicationRecipient,
): CommunicationChannel | null {
  if (nonBlank(recipient.email)) return 'email';
  if (nonBlank(recipient.whatsapp)) return 'whatsapp';
  if (nonBlank(recipient.phone)) return 'sms';
  if (nonBlank(recipient.subjectId)) return 'in_app';
  return null;
}

export function communicationRecipientKey(
  recipient: CommunicationRecipient,
  channel: CommunicationChannel,
): string {
  if (!recipientSupportsChannel(recipient, channel)) {
    throw new CommunicationIntentError(
      'CHANNEL_RECIPIENT_MISMATCH',
      `Recipient does not support communication channel ${channel}.`,
    );
  }

  switch (communicationChannelMetadata(channel).addressKind) {
    case 'email':
      return recipient.email!.trim().toLowerCase();
    case 'phone':
      return recipient.phone!.trim();
    case 'whatsapp':
      return (recipient.whatsapp ?? recipient.phone)!.trim();
    case 'subject':
      return recipient.subjectId!.trim();
    case 'push':
      return (recipient.pushEndpoint ?? recipient.subjectId)!.trim();
  }
}

export function recipientSupportsChannel(
  recipient: CommunicationRecipient,
  channel: CommunicationChannel,
): boolean {
  switch (communicationChannelMetadata(channel).addressKind) {
    case 'email':
      return nonBlank(recipient.email);
    case 'phone':
      return nonBlank(recipient.phone);
    case 'whatsapp':
      return nonBlank(recipient.whatsapp ?? recipient.phone);
    case 'subject':
      return nonBlank(recipient.subjectId);
    case 'push':
      return nonBlank(recipient.pushEndpoint) || nonBlank(recipient.subjectId);
  }
}

function nonBlank(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}
