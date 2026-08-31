/**
 * AutoGTM → Communication seam.
 *
 * After Decision Fabric APPROVE on gtm.sequence.publish, the vertical files a
 * Communication intent on capability communication.email.send / connector
 * gtm.email. This module never sends. The lab adapter is forbidden here.
 */

export const GTM_SEND_CAPABILITY_KEY = 'communication.email.send' as const;
export const GTM_EMAIL_CONNECTOR_KEY = 'gtm.email' as const;
export const GTM_EMAIL_PROVIDER_KEY = 'resend' as const;
export const GTM_SEQUENCE_WORK_TYPE = 'gtm.sequence.publish' as const;
export const GTM_SEQUENCE_APPROVED_STAGE = 'APPROVED' as const;

export type GtmSendDenial =
  | 'NOT_APPROVED'
  | 'SEPARATION_OF_DUTIES'
  | 'CONNECTOR_DISABLED'
  | 'CONNECTOR_MISSING'
  | 'INVALID_TOUCH';

export class GtmSendGateError extends Error {
  readonly code: GtmSendDenial;
  constructor(code: GtmSendDenial, message: string) {
    super(message);
    this.name = 'GtmSendGateError';
    this.code = code;
  }
}

export interface GtmSequenceTouch {
  readonly sequenceId: string;
  readonly stepKey: string;
  readonly tenantId: string;
  readonly subject: string;
  readonly body: string;
  readonly recipientEmail: string;
  readonly recipientSubjectId?: string;
  readonly stageKey: string | null;
  readonly authorSubjectId: string;
}

export interface GtmEmailConnectorState {
  readonly connectorKey: string;
  readonly enabled: boolean;
  readonly providerKey: string;
}

export interface GtmCommunicationIntent {
  readonly capabilityKey: typeof GTM_SEND_CAPABILITY_KEY;
  readonly connectorKey: typeof GTM_EMAIL_CONNECTOR_KEY;
  readonly providerKey: typeof GTM_EMAIL_PROVIDER_KEY;
  readonly triggerKey: typeof GTM_SEQUENCE_WORK_TYPE;
  readonly sendRequest: {
    readonly tenantId: string;
    readonly triggerKey: typeof GTM_SEQUENCE_WORK_TYPE;
    readonly purpose: 'marketing';
    readonly channel: 'email';
    readonly recipient: { readonly email: string; readonly subjectId?: string };
    readonly recipientKey: string;
    readonly rendered: { readonly format: 'TEXT'; readonly subject: string; readonly body: string };
    readonly idempotencyKey: string;
    readonly requestedAt: string;
  };
}

export function assertApprovedForSend(params: {
  readonly stageKey: string | null;
  readonly authorSubjectId: string;
  readonly actorSubjectId: string;
}): void {
  if (params.stageKey !== GTM_SEQUENCE_APPROVED_STAGE) {
    throw new GtmSendGateError(
      'NOT_APPROVED',
      `GTM send requires stage ${GTM_SEQUENCE_APPROVED_STAGE}; current stage is ${params.stageKey ?? 'unbound'}.`,
    );
  }
  if (!params.actorSubjectId.trim()) {
    throw new GtmSendGateError('SEPARATION_OF_DUTIES', 'Actor subject id is required.');
  }
  if (params.actorSubjectId === params.authorSubjectId) {
    throw new GtmSendGateError(
      'SEPARATION_OF_DUTIES',
      'Author cannot file the Communication intent for their own sequence.',
    );
  }
}

export function assertConnectorReady(connector: GtmEmailConnectorState | null): void {
  if (connector === null || connector.connectorKey !== GTM_EMAIL_CONNECTOR_KEY) {
    throw new GtmSendGateError('CONNECTOR_MISSING', 'Connector gtm.email is not registered.');
  }
  if (!connector.enabled) {
    throw new GtmSendGateError(
      'CONNECTOR_DISABLED',
      'Connector gtm.email is disabled until BYOC and sender identity are bound.',
    );
  }
}

export function buildGtmCommunicationIntent(params: {
  readonly touch: GtmSequenceTouch;
  readonly actorSubjectId: string;
  readonly requestedAt?: string;
}): GtmCommunicationIntent {
  assertApprovedForSend({
    stageKey: params.touch.stageKey,
    authorSubjectId: params.touch.authorSubjectId,
    actorSubjectId: params.actorSubjectId,
  });
  const body = params.touch.body.trim();
  const subject = params.touch.subject.trim();
  const email = params.touch.recipientEmail.trim();
  if (!body || !subject || !email.includes('@')) {
    throw new GtmSendGateError('INVALID_TOUCH', 'Approved touch is missing subject, body, or recipient email.');
  }
  const requestedAt = params.requestedAt ?? new Date().toISOString();
  return {
    capabilityKey: GTM_SEND_CAPABILITY_KEY,
    connectorKey: GTM_EMAIL_CONNECTOR_KEY,
    providerKey: GTM_EMAIL_PROVIDER_KEY,
    triggerKey: GTM_SEQUENCE_WORK_TYPE,
    sendRequest: {
      tenantId: params.touch.tenantId,
      triggerKey: GTM_SEQUENCE_WORK_TYPE,
      purpose: 'marketing',
      channel: 'email',
      recipient: {
        email,
        ...(params.touch.recipientSubjectId ? { subjectId: params.touch.recipientSubjectId } : {}),
      },
      recipientKey: email,
      rendered: { format: 'TEXT', subject, body },
      idempotencyKey: `${GTM_SEQUENCE_WORK_TYPE}:${params.touch.sequenceId}:${params.touch.stepKey}:${email}`,
      requestedAt,
    },
  };
}

export const WARM_REPLY_CAPTURE_CLASSES = ['interested', 'meeting_requested'] as const;
export type WarmReplyCaptureClass = (typeof WARM_REPLY_CAPTURE_CLASSES)[number];

export const REPLY_CLASSES = [
  'interested',
  'meeting_requested',
  'not_now',
  'not_a_fit',
  'unsubscribe',
  'out_of_office',
  'bounce',
  'unknown',
] as const;
export type ReplyClass = (typeof REPLY_CLASSES)[number];

export function isReplyClass(value: string): value is ReplyClass {
  return (REPLY_CLASSES as readonly string[]).includes(value);
}

export function shouldConvertReplyToLead(proposedClass: string): proposedClass is WarmReplyCaptureClass {
  return (WARM_REPLY_CAPTURE_CLASSES as readonly string[]).includes(proposedClass);
}
