import type { GovernedActionIntent } from '@expadio/governed-actions';
import { OTP_TTL_SECONDS } from './lead-capture-otp.ts';

/**
 * Builds the governed COMMUNICATE intent that sends a PUBLIC-rail OTP through the
 * existing Communications fabric. Pure (only a type import), so the exact
 * configuration the fabric receives is unit-testable without a database.
 *
 * The plaintext code travels as a template variable only; it is never persisted
 * (the challenge stores a salted hash) and must never be logged.
 */

export const OTP_TRIGGER_KEY = 'lead-capture.otp';
/** Email send capability the provider registry routes on (matches the fabric). */
export const OTP_CAPABILITY_KEY = 'communication.email.send';
export const OTP_RULE_KEY = 'lead-capture.otp.send.v1';
export const OTP_ACTION_KEY = 'lead-capture.otp.send';
export const OTP_SERVICE_SUBJECT = 'service:lead-capture';

export interface OtpCommunicateIntentInput {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly captureLeadId: string;
  readonly recipientEmail: string;
  readonly code: string;
  readonly now?: Date;
}

export function buildOtpCommunicateIntent(input: OtpCommunicateIntentInput): GovernedActionIntent {
  const requestedAt = input.now ?? new Date();
  // One pending challenge per capture in the current design, so the delivery is
  // idempotent on the capture id (a resend would mint a new challenge + key).
  const idempotencyKey = `${OTP_TRIGGER_KEY}:${input.captureLeadId}`;
  return {
    tenantId: input.tenantId,
    sourceEventId: idempotencyKey,
    sourceEventType: 'LeadCapture.VerificationChallenged',
    aggregateType: 'lead.capture',
    aggregateId: input.captureLeadId,
    ruleKey: OTP_RULE_KEY,
    executorClass: 'COMMUNICATE',
    actionKey: OTP_ACTION_KEY,
    idempotencyKey,
    correlationId: input.captureLeadId,
    causationId: input.captureLeadId,
    requestedBySubjectId: OTP_SERVICE_SUBJECT,
    requestedAt,
    configuration: {
      triggerKey: OTP_TRIGGER_KEY,
      capabilityKey: OTP_CAPABILITY_KEY,
      channel: 'email',
      purpose: 'transactional',
      // Transactional identity verification is not marketing; consent is not
      // required, but suppression is still honored by the preflight.
      consentRequired: false,
      organizationId: input.organizationId,
      recipient: { email: input.recipientEmail },
      variables: {
        code: input.code,
        ttlMinutes: Math.round(OTP_TTL_SECONDS / 60),
      },
    },
    policyDecision: {
      allowed: true,
      policyKeys: [],
      evidenceRefs: [`capture-verification:${input.captureLeadId}`],
      reasonCode: 'OK',
      evaluatedAt: requestedAt,
    },
  };
}
