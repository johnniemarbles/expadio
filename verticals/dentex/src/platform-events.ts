import { DENTEX_VERTICAL_KEY } from './domain.ts';
import type { DentexDomainEvent, DentexDomainEventType } from './events.ts';

export interface DentexPlatformDomainEventEnvelope {
  readonly eventId: string;
  readonly eventType: DentexDomainEventType;
  readonly verticalKey: typeof DENTEX_VERTICAL_KEY;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly aggregateType: DentexDomainEvent['aggregateType'];
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly subjectId?: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly decisionTraceId?: string;
  readonly payload: DentexDomainEvent['payload'];
  readonly metadata: {
    readonly source: DentexDomainEvent['audit']['source'];
    readonly policyVersion?: string;
    readonly workflowBlueprintKey?: string;
  };
}

export function toDentexPlatformDomainEvent(
  event: DentexDomainEvent,
): DentexPlatformDomainEventEnvelope {
  assertNonBlank(event.eventId, 'eventId');
  assertNonBlank(event.eventType, 'eventType');
  assertNonBlank(event.tenantId, 'tenantId');
  assertNonBlank(event.organizationId, 'organizationId');
  assertNonBlank(event.aggregateId, 'aggregateId');
  assertNonBlank(event.occurredAt, 'occurredAt');

  const correlationId = nonBlank(event.audit.correlationId)
    ? event.audit.correlationId.trim()
    : event.eventId.trim();

  const envelope: DentexPlatformDomainEventEnvelope = {
    eventId: event.eventId.trim(),
    eventType: event.eventType,
    verticalKey: DENTEX_VERTICAL_KEY,
    tenantId: event.tenantId.trim(),
    organizationId: event.organizationId.trim(),
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId.trim(),
    occurredAt: event.occurredAt.trim(),
    correlationId,
    idempotencyKey: dentexDomainEventIdempotencyKey(event),
    payload: event.payload,
    metadata: {
      source: event.audit.source,
    },
  };

  const subjectId = trimOptional(event.audit.subjectId);
  if (subjectId !== undefined) {
    envelope.subjectId = subjectId;
  }

  const decisionTraceId = trimOptional(event.decision?.decisionTraceId);
  if (decisionTraceId !== undefined) {
    envelope.decisionTraceId = decisionTraceId;
  }

  const policyVersion = trimOptional(event.decision?.policyVersion);
  if (policyVersion !== undefined) {
    envelope.metadata.policyVersion = policyVersion;
  }

  const workflowBlueprintKey = trimOptional(event.decision?.workflowBlueprintKey);
  if (workflowBlueprintKey !== undefined) {
    envelope.metadata.workflowBlueprintKey = workflowBlueprintKey;
  }

  return envelope;
}

export function dentexDomainEventIdempotencyKey(event: DentexDomainEvent): string {
  assertNonBlank(event.tenantId, 'tenantId');
  assertNonBlank(event.eventType, 'eventType');
  assertNonBlank(event.eventId, 'eventId');
  return `${DENTEX_VERTICAL_KEY}:${event.tenantId.trim()}:${event.eventType}:${event.eventId.trim()}`;
}

function trimOptional(value: string | undefined): string | undefined {
  if (!nonBlank(value)) return undefined;
  return value.trim();
}

function assertNonBlank(value: string, field: string): void {
  if (!nonBlank(value)) {
    throw new DentexPlatformEventMappingError(`${field.toUpperCase()}_REQUIRED`, `${field} is required.`);
  }
}

function nonBlank(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

export class DentexPlatformEventMappingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DentexPlatformEventMappingError';
    this.code = code;
  }
}
