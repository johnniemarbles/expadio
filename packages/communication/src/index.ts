export type CommunicationChannel =
  | 'email'
  | 'sms'
  | 'whatsapp'
  | 'in_app'
  | 'push'
  | 'rcs'
  | 'voice';

export type CommunicationPurpose = 'transactional' | 'marketing' | 'system';

export interface CommunicationRecipient {
  readonly subjectId?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly whatsapp?: string;
  /** Opaque EXPADIO endpoint identifier. Never place a raw provider device token here. */
  readonly pushEndpointId?: string;
}

export interface CommunicationSendRequest {
  readonly triggerKey: string;
  readonly tenantId: string;
  readonly organizationId?: string | null;
  readonly recipient: CommunicationRecipient;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly locale?: string;
  readonly idempotencyKey: string;
  readonly purpose: CommunicationPurpose;
  readonly consentRequired: boolean;
  /** Optional channel selected by policy/routing. */
  readonly channel?: CommunicationChannel;
  readonly correlationId?: string;
  readonly conversationId?: string;
}

export type CommunicationSendReasonCode =
  | 'OK'
  | 'CONSENT_MISSING'
  | 'SUPPRESSED'
  | 'PROVIDER_DOWN'
  | 'TEMPLATE_MISSING'
  | 'RATE_LIMITED'
  | 'RESIDENCY_BLOCKED'
  | 'DOMAIN_UNVERIFIED'
  | 'QUIET_HOURS'
  | 'THROTTLED'
  | 'PLATFORM_GOVERNANCE'
  | 'ORGANIZATION_GOVERNANCE'
  | 'CAPABILITY_UNAVAILABLE'
  | 'INVALID_RECIPIENT';

export interface CommunicationSendResponse {
  readonly state: 'QUEUED' | 'SENT' | 'REFUSED' | 'NOT_WIRED';
  readonly reasonCode: CommunicationSendReasonCode;
  /** EXPADIO message identifier, not necessarily the provider message identifier. */
  readonly messageId: string | null;
  readonly providerMessageId?: string;
  readonly refusalReason?: string;
  readonly providerKey?: string;
  readonly queuedAt?: string;
}

export interface CommunicationSuppressionCheck {
  readonly recipientKey: string;
  readonly channel: CommunicationChannel;
  readonly reason:
    | 'BOUNCE'
    | 'COMPLAINT'
    | 'OPT_OUT'
    | 'LEGAL_HOLD'
    | 'PLATFORM_TIER'
    | 'UNSUBSCRIBE';
}

export type ConversationOwnerType = 'HUMAN' | 'AI' | 'SYSTEM';
export type ConversationDirection = 'INBOUND' | 'OUTBOUND';
export type ConversationSenderType = 'PERSON' | 'HUMAN' | 'AI' | 'SYSTEM';

export interface ConversationContextRef {
  readonly kind: string;
  readonly id: string;
}

export interface CreateConversationInput {
  readonly tenantId: string;
  readonly organizationId?: string;
  readonly subjectId?: string;
  readonly channel?: CommunicationChannel;
  readonly ownerType?: ConversationOwnerType;
  readonly ownerId?: string;
  readonly context?: readonly ConversationContextRef[];
}

export interface AppendConversationMessageInput {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly channel: CommunicationChannel;
  readonly direction: ConversationDirection;
  readonly senderType: ConversationSenderType;
  readonly senderId?: string;
  readonly communicationMessageId?: string;
  readonly providerMessageId?: string;
  readonly body?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly occurredAt?: string;
}

export type CommunicationContractErrorCode =
  | 'TRIGGER_REQUIRED'
  | 'TENANT_REQUIRED'
  | 'IDEMPOTENCY_REQUIRED'
  | 'MARKETING_CONSENT_REQUIRED'
  | 'RECIPIENT_REQUIRED'
  | 'CHANNEL_RECIPIENT_MISMATCH';

export class CommunicationContractError extends Error {
  constructor(
    readonly code: CommunicationContractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CommunicationContractError';
  }
}

export function validateCommunicationRequest(request: CommunicationSendRequest): void {
  if (request.triggerKey.trim().length === 0) {
    throw new CommunicationContractError('TRIGGER_REQUIRED', 'triggerKey is required.');
  }
  if (request.tenantId.trim().length === 0) {
    throw new CommunicationContractError('TENANT_REQUIRED', 'tenantId is required.');
  }
  if (request.idempotencyKey.trim().length === 0) {
    throw new CommunicationContractError('IDEMPOTENCY_REQUIRED', 'idempotencyKey is required.');
  }
  if (request.purpose === 'marketing' && request.consentRequired !== true) {
    throw new CommunicationContractError(
      'MARKETING_CONSENT_REQUIRED',
      'Marketing communication requires consentRequired=true.',
    );
  }

  const channel = request.channel ?? inferDefaultChannel(request.recipient);
  if (channel === null) {
    throw new CommunicationContractError('RECIPIENT_REQUIRED', 'Recipient has no routable address.');
  }
  assertRecipientSupportsChannel(request.recipient, channel);
}

export function inferDefaultChannel(recipient: CommunicationRecipient): CommunicationChannel | null {
  if (nonEmpty(recipient.email)) return 'email';
  if (nonEmpty(recipient.whatsapp)) return 'whatsapp';
  if (nonEmpty(recipient.phone)) return 'sms';
  if (nonEmpty(recipient.subjectId)) return 'in_app';
  return null;
}

export function deriveRecipientKey(
  recipient: CommunicationRecipient,
  channel: CommunicationChannel,
): string {
  assertRecipientSupportsChannel(recipient, channel);

  switch (channel) {
    case 'email':
      return recipient.email!.trim().toLowerCase();
    case 'whatsapp':
      return recipient.whatsapp!.trim();
    case 'sms':
    case 'rcs':
    case 'voice':
      return recipient.phone!.trim();
    case 'push':
      return (recipient.pushEndpointId ?? recipient.subjectId)!.trim();
    case 'in_app':
      return recipient.subjectId!.trim();
  }
}

function assertRecipientSupportsChannel(
  recipient: CommunicationRecipient,
  channel: CommunicationChannel,
): void {
  const supported =
    channel === 'email'
      ? nonEmpty(recipient.email)
      : channel === 'whatsapp'
        ? nonEmpty(recipient.whatsapp)
        : channel === 'sms' || channel === 'rcs' || channel === 'voice'
          ? nonEmpty(recipient.phone)
          : channel === 'push'
            ? nonEmpty(recipient.pushEndpointId) || nonEmpty(recipient.subjectId)
            : nonEmpty(recipient.subjectId);

  if (!supported) {
    throw new CommunicationContractError(
      'CHANNEL_RECIPIENT_MISMATCH',
      `Recipient does not contain an address compatible with ${channel}.`,
    );
  }
}

function nonEmpty(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
