import type { DomainEventEnvelope } from '@expadio/domain-events';

export const GOVERNED_ACTION_EXECUTOR_CLASSES = [
  'COMMUNICATE',
  'ASSIGN',
  'CREATE_TASK',
  'START_WORKFLOW',
  'ADVANCE_WORKFLOW',
  'CREATE_DOCUMENT',
  'REQUEST_APPROVAL',
  'WEBHOOK',
  'INTEGRATION',
  'AI_ACTION',
  'SCHEDULE',
] as const;

export type GovernedActionExecutorClass =
  (typeof GOVERNED_ACTION_EXECUTOR_CLASSES)[number];

export interface GovernedActionRule {
  readonly ruleKey: string;
  readonly eventType: string;
  readonly executorClass: GovernedActionExecutorClass;
  readonly actionKey: string;
  readonly enabled: boolean;
  readonly policyKeys: readonly string[];
  readonly configuration: Readonly<Record<string, unknown>>;
}

export interface GovernedActionPolicyDecision {
  readonly allowed: boolean;
  readonly policyKeys: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly reasonCode: string;
  readonly evaluatedAt: Date;
}

export interface GovernedActionIntent {
  readonly tenantId: string;
  readonly sourceEventId: string;
  readonly sourceEventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly ruleKey: string;
  readonly executorClass: GovernedActionExecutorClass;
  readonly actionKey: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly requestedBySubjectId: string;
  readonly requestedAt: Date;
  readonly configuration: Readonly<Record<string, unknown>>;
  readonly policyDecision: GovernedActionPolicyDecision;
}

export type GovernedActionResolution =
  | { readonly matched: false; readonly reason: 'RULE_DISABLED' | 'EVENT_TYPE_MISMATCH' }
  | { readonly matched: true; readonly allowed: false; readonly reasonCode: string }
  | { readonly matched: true; readonly allowed: true; readonly intent: GovernedActionIntent };

export class GovernedActionValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GovernedActionValidationError';
    this.code = code;
  }
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === '') {
    throw new GovernedActionValidationError(
      'GOVERNED_ACTION_FIELD_REQUIRED',
      `${field} must not be blank.`,
    );
  }
  return normalized;
}

function validDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new GovernedActionValidationError(
      'GOVERNED_ACTION_DATE_INVALID',
      `${field} must be a valid date.`,
    );
  }
  return value;
}

export function governedActionIdempotencyKey(input: {
  readonly eventId: string;
  readonly ruleKey: string;
  readonly executorClass: GovernedActionExecutorClass;
}): string {
  return [
    required(input.eventId, 'eventId'),
    required(input.ruleKey, 'ruleKey'),
    input.executorClass,
  ].join(':');
}

/**
 * Resolve a Domain Event through one Action Rule and its already-evaluated
 * policy decision.
 *
 * No provider or capability is invoked here. A permitted result is an immutable
 * Action Intent that a separate executor layer can claim later.
 */
export function resolveGovernedAction(
  event: DomainEventEnvelope,
  rule: GovernedActionRule,
  policyDecision: GovernedActionPolicyDecision,
): GovernedActionResolution {
  const ruleKey = required(rule.ruleKey, 'ruleKey');
  const eventType = required(rule.eventType, 'eventType');
  const actionKey = required(rule.actionKey, 'actionKey');

  if (!rule.enabled) {
    return { matched: false, reason: 'RULE_DISABLED' };
  }
  if (event.eventType !== eventType) {
    return { matched: false, reason: 'EVENT_TYPE_MISMATCH' };
  }

  validDate(policyDecision.evaluatedAt, 'policyDecision.evaluatedAt');
  const reasonCode = required(policyDecision.reasonCode, 'policyDecision.reasonCode');
  const requiredPolicyKeys = rule.policyKeys.map((key) => required(key, 'policyKey'));
  const evaluatedPolicyKeys = new Set(
    policyDecision.policyKeys.map((key) => required(key, 'policyDecision.policyKey')),
  );
  const missingPolicyKeys = requiredPolicyKeys.filter((key) => !evaluatedPolicyKeys.has(key));

  if (missingPolicyKeys.length > 0) {
    return {
      matched: true,
      allowed: false,
      reasonCode: 'POLICY_EVALUATION_INCOMPLETE',
    };
  }

  if (!policyDecision.allowed) {
    return {
      matched: true,
      allowed: false,
      reasonCode,
    };
  }

  return {
    matched: true,
    allowed: true,
    intent: {
      tenantId: event.tenantId,
      sourceEventId: event.eventId,
      sourceEventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      ruleKey,
      executorClass: rule.executorClass,
      actionKey,
      idempotencyKey: governedActionIdempotencyKey({
        eventId: event.eventId,
        ruleKey,
        executorClass: rule.executorClass,
      }),
      correlationId: event.correlationId,
      causationId: event.eventId,
      requestedBySubjectId: event.actorSubjectId,
      requestedAt: policyDecision.evaluatedAt,
      configuration: rule.configuration,
      policyDecision: {
        allowed: true,
        policyKeys: [...policyDecision.policyKeys],
        evidenceRefs: [...policyDecision.evidenceRefs],
        reasonCode,
        evaluatedAt: policyDecision.evaluatedAt,
      },
    },
  };
}
