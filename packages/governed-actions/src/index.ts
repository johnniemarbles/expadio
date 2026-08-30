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

  // A denial may short-circuit as soon as one policy blocks the action.
  // An allow decision is different: it must prove every policy required by the
  // rule was evaluated, otherwise an omitted policy could be bypassed.
  if (!policyDecision.allowed) {
    return {
      matched: true,
      allowed: false,
      reasonCode,
    };
  }

  const missingPolicyKeys = requiredPolicyKeys.filter((key) => !evaluatedPolicyKeys.has(key));
  if (missingPolicyKeys.length > 0) {
    return {
      matched: true,
      allowed: false,
      reasonCode: 'POLICY_EVALUATION_INCOMPLETE',
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


export * from './execution.ts';


export type GovernedActionValueBinding =
  | { readonly kind: 'LITERAL'; readonly value: unknown }
  | { readonly kind: 'EVENT_PAYLOAD'; readonly key: string; readonly required?: boolean }
  | { readonly kind: 'AGGREGATE_FIELD'; readonly key: string; readonly required?: boolean };

export type GovernedActionConfigurationTemplateValue =
  | null
  | boolean
  | number
  | string
  | GovernedActionValueBinding
  | readonly GovernedActionConfigurationTemplateValue[]
  | { readonly [key: string]: GovernedActionConfigurationTemplateValue };

export interface GovernedActionBindingContext {
  readonly event: DomainEventEnvelope;
  /**
   * Application-supplied flat aggregate projection. The generic action domain
   * deliberately does not know how to query a Treatment, Shipment, Matter, etc.
   */
  readonly aggregateFields: Readonly<Record<string, unknown>>;
}

function bindingKey(value: string, field: string): string {
  const key = value.trim();
  if (key === '' || key.includes('.') || key.includes('[') || key.includes(']')) {
    throw new GovernedActionValidationError(
      'GOVERNED_ACTION_BINDING_KEY_INVALID',
      `${field} must be one top-level field key.`,
    );
  }
  return key;
}

function isBinding(value: unknown): value is GovernedActionValueBinding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const kind = (value as { readonly kind?: unknown }).kind;
  return kind === 'LITERAL' || kind === 'EVENT_PAYLOAD' || kind === 'AGGREGATE_FIELD';
}

function materializeBinding(
  binding: GovernedActionValueBinding,
  context: GovernedActionBindingContext,
): unknown {
  if (binding.kind === 'LITERAL') return binding.value;

  const key = bindingKey(binding.key, 'binding.key');
  const source = binding.kind === 'EVENT_PAYLOAD'
    ? context.event.payload
    : context.aggregateFields;
  const value = source[key];

  if (value === undefined && binding.required !== false) {
    throw new GovernedActionValidationError(
      'GOVERNED_ACTION_BINDING_VALUE_REQUIRED',
      `No value is available for ${binding.kind}:${key}.`,
    );
  }
  return value ?? null;
}

/**
 * Materialize a governed Action configuration from a Domain Event and an
 * application-provided aggregate projection.
 *
 * Bindings deliberately address only top-level keys. This keeps Pack rules
 * inspectable and avoids introducing a generic JSONPath/expression engine.
 */
export function materializeGovernedActionConfiguration(
  template: GovernedActionConfigurationTemplateValue,
  context: GovernedActionBindingContext,
): unknown {
  if (isBinding(template)) return materializeBinding(template, context);
  if (Array.isArray(template)) {
    return template.map((value) => materializeGovernedActionConfiguration(value, context));
  }
  if (typeof template === 'object' && template !== null) {
    return Object.fromEntries(
      Object.entries(template).map(([key, value]) => [
        key,
        materializeGovernedActionConfiguration(value, context),
      ]),
    );
  }
  return template;
}
