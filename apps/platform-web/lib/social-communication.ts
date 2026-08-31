/**
 * Social Content → Communication seam.
 *
 * After Decision Fabric APPROVE on social.content_publish, a reviewer (not the
 * author) may file a Communication intent on capability communication.social.send
 * / connector social.linkedin. This module never sends. Connector dark is a
 * response reason, not a reason to skip mapping the approved copy onto a
 * COMMUNICATE Action Intent. Decision Fabric PR #482 stays HOLD — this seam
 * does not register the vertical subject table or blueprint.
 */

import type { GovernedActionIntent } from '@expadio/governed-actions';

export const SOCIAL_SEND_CAPABILITY_KEY = 'communication.social.send' as const;
export const SOCIAL_LINKEDIN_CONNECTOR_KEY = 'social.linkedin' as const;
export const SOCIAL_LINKEDIN_PROVIDER_KEY = 'linkedin' as const;
export const SOCIAL_CONTENT_WORK_TYPE = 'social.content_publish' as const;
export const SOCIAL_CONTENT_APPROVED_STAGE = 'APPROVED' as const;
export const SOCIAL_COMMUNICATE_EVENT_TYPE = 'social.content.communicate' as const;
export const SOCIAL_COMMUNICATE_RULE_KEY = 'social.content.communicate' as const;
export const SOCIAL_COMMUNICATE_ACTION_KEY = 'social.linkedin.send' as const;

export type SocialSendDenial =
  | 'NOT_APPROVED'
  | 'SEPARATION_OF_DUTIES'
  | 'CONNECTOR_DISABLED'
  | 'CONNECTOR_MISSING'
  | 'INVALID_TOUCH';

export class SocialSendGateError extends Error {
  readonly code: SocialSendDenial;
  constructor(code: SocialSendDenial, message: string) {
    super(message);
    this.name = 'SocialSendGateError';
    this.code = code;
  }
}

export interface SocialContentTouch {
  readonly contentItemId: string;
  readonly slotKey: string;
  readonly tenantId: string;
  readonly body: string;
  readonly recipientSubjectId: string;
  readonly stageKey: string | null;
  readonly authorSubjectId: string;
}

export interface SocialLinkedInConnectorState {
  readonly connectorKey: string;
  readonly enabled: boolean;
  readonly providerKey: string;
}

export interface SocialCommunicationIntent {
  readonly capabilityKey: typeof SOCIAL_SEND_CAPABILITY_KEY;
  readonly connectorKey: typeof SOCIAL_LINKEDIN_CONNECTOR_KEY;
  readonly providerKey: typeof SOCIAL_LINKEDIN_PROVIDER_KEY;
  readonly triggerKey: typeof SOCIAL_CONTENT_WORK_TYPE;
  readonly sendRequest: {
    readonly tenantId: string;
    readonly triggerKey: typeof SOCIAL_CONTENT_WORK_TYPE;
    readonly purpose: 'marketing';
    readonly channel: 'social';
    readonly recipient: { readonly subjectId: string };
    readonly recipientKey: string;
    readonly rendered: { readonly format: 'TEXT'; readonly body: string };
    readonly idempotencyKey: string;
    readonly requestedAt: string;
  };
}

export interface SocialCommunicationFileResult {
  readonly intent: SocialCommunicationIntent;
  readonly actionIntent: GovernedActionIntent;
  readonly sent: false;
  readonly dispatched: false;
  readonly persisted: true;
  readonly reasonKey: Extract<SocialSendDenial, 'CONNECTOR_MISSING' | 'CONNECTOR_DISABLED'> | 'INTENT_PERSISTED_NOT_DISPATCHED';
}

export function assertApprovedForSend(params: {
  readonly stageKey: string | null;
  readonly authorSubjectId: string;
  readonly actorSubjectId: string;
}): void {
  if (params.stageKey !== SOCIAL_CONTENT_APPROVED_STAGE) {
    throw new SocialSendGateError(
      'NOT_APPROVED',
      `Social send requires stage ${SOCIAL_CONTENT_APPROVED_STAGE}; current stage is ${params.stageKey ?? 'unbound'}.`,
    );
  }
  if (!params.actorSubjectId.trim()) {
    throw new SocialSendGateError('SEPARATION_OF_DUTIES', 'Actor subject id is required.');
  }
  if (params.actorSubjectId === params.authorSubjectId) {
    throw new SocialSendGateError(
      'SEPARATION_OF_DUTIES',
      'Author cannot file the Communication intent for their own social content.',
    );
  }
}

export function readSocialLinkedInConnector(connector: SocialLinkedInConnectorState | null): {
  readonly ready: boolean;
  readonly code: Extract<SocialSendDenial, 'CONNECTOR_MISSING' | 'CONNECTOR_DISABLED'> | 'OK';
} {
  if (connector === null || connector.connectorKey !== SOCIAL_LINKEDIN_CONNECTOR_KEY) {
    return { ready: false, code: 'CONNECTOR_MISSING' };
  }
  if (!connector.enabled) {
    return { ready: false, code: 'CONNECTOR_DISABLED' };
  }
  return { ready: true, code: 'OK' };
}

export function assertConnectorReady(connector: SocialLinkedInConnectorState | null): void {
  const state = readSocialLinkedInConnector(connector);
  if (state.code === 'CONNECTOR_MISSING') {
    throw new SocialSendGateError('CONNECTOR_MISSING', 'Connector social.linkedin is not registered.');
  }
  if (state.code === 'CONNECTOR_DISABLED') {
    throw new SocialSendGateError(
      'CONNECTOR_DISABLED',
      'Connector social.linkedin is disabled until tenant BYOC and a governed lease are bound.',
    );
  }
}

export function buildSocialCommunicationIntent(params: {
  readonly touch: SocialContentTouch;
  readonly actorSubjectId: string;
  readonly requestedAt?: string;
}): SocialCommunicationIntent {
  assertApprovedForSend({
    stageKey: params.touch.stageKey,
    authorSubjectId: params.touch.authorSubjectId,
    actorSubjectId: params.actorSubjectId,
  });
  const body = params.touch.body.trim();
  const subjectId = params.touch.recipientSubjectId.trim();
  const slotKey = params.touch.slotKey.trim();
  const contentItemId = params.touch.contentItemId.trim();
  if (!body || !subjectId || !slotKey || !contentItemId) {
    throw new SocialSendGateError(
      'INVALID_TOUCH',
      'Approved social touch is missing body, recipient subject id, slot, or content id.',
    );
  }
  const requestedAt = params.requestedAt ?? new Date().toISOString();
  return {
    capabilityKey: SOCIAL_SEND_CAPABILITY_KEY,
    connectorKey: SOCIAL_LINKEDIN_CONNECTOR_KEY,
    providerKey: SOCIAL_LINKEDIN_PROVIDER_KEY,
    triggerKey: SOCIAL_CONTENT_WORK_TYPE,
    sendRequest: {
      tenantId: params.touch.tenantId,
      triggerKey: SOCIAL_CONTENT_WORK_TYPE,
      purpose: 'marketing',
      channel: 'social',
      recipient: { subjectId },
      recipientKey: subjectId,
      rendered: { format: 'TEXT', body },
      idempotencyKey: `${SOCIAL_CONTENT_WORK_TYPE}:${contentItemId}:${slotKey}:${subjectId}`,
      requestedAt,
    },
  };
}

/** Map a filed social touch onto a COMMUNICATE Action Intent. Does not enqueue delivery. */
export function toGovernedCommunicateIntent(params: {
  readonly social: SocialCommunicationIntent;
  readonly actorSubjectId: string;
  readonly contentItemId: string;
  readonly slotKey: string;
}): GovernedActionIntent {
  const requestedAt = new Date(params.social.sendRequest.requestedAt);
  return {
    tenantId: params.social.sendRequest.tenantId,
    sourceEventId: params.contentItemId,
    sourceEventType: SOCIAL_COMMUNICATE_EVENT_TYPE,
    aggregateType: 'social.content',
    aggregateId: params.contentItemId,
    ruleKey: `${SOCIAL_COMMUNICATE_RULE_KEY}:${params.slotKey}`,
    executorClass: 'COMMUNICATE',
    actionKey: SOCIAL_COMMUNICATE_ACTION_KEY,
    idempotencyKey: params.social.sendRequest.idempotencyKey,
    correlationId: params.social.sendRequest.idempotencyKey,
    causationId: params.contentItemId,
    requestedBySubjectId: params.actorSubjectId,
    requestedAt,
    configuration: {
      triggerKey: params.social.triggerKey,
      recipient: params.social.sendRequest.recipient,
      variables: {
        body: params.social.sendRequest.rendered.body,
      },
      purpose: params.social.sendRequest.purpose,
      consentRequired: true,
      channel: params.social.sendRequest.channel,
      capabilityKey: params.social.capabilityKey,
      connectorKey: params.social.connectorKey,
      providerKey: params.social.providerKey,
    },
    policyDecision: {
      allowed: true,
      policyKeys: ['social.content_publish.approved', 'social.separation_of_duties'],
      evidenceRefs: [
        `social://content/${params.contentItemId}`,
        `social://slot/${params.slotKey}`,
      ],
      reasonCode: 'SOCIAL_CONTENT_APPROVED',
      evaluatedAt: requestedAt,
    },
  };
}

/**
 * File the Communication intent after APPROVE + SoD. Always dark on send:
 * `sent` / `dispatched` stay false. Connector disabled is a reason key, not a
 * skip of the COMMUNICATE mapping (ADR-011).
 */
export function fileSocialCommunicationIntent(params: {
  readonly touch: SocialContentTouch;
  readonly actorSubjectId: string;
  readonly connector: SocialLinkedInConnectorState | null;
  readonly requestedAt?: string;
}): SocialCommunicationFileResult {
  const intent = buildSocialCommunicationIntent({
    touch: params.touch,
    actorSubjectId: params.actorSubjectId,
    ...(params.requestedAt === undefined ? {} : { requestedAt: params.requestedAt }),
  });
  const actionIntent = toGovernedCommunicateIntent({
    social: intent,
    actorSubjectId: params.actorSubjectId,
    contentItemId: params.touch.contentItemId,
    slotKey: params.touch.slotKey,
  });
  const connectorState = readSocialLinkedInConnector(params.connector);
  return {
    intent,
    actionIntent,
    sent: false,
    dispatched: false,
    persisted: true,
    reasonKey: connectorState.ready ? 'INTENT_PERSISTED_NOT_DISPATCHED' : connectorState.code,
  };
}
