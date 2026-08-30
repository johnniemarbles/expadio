import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DomainEventValidationError,
  createDomainEvent,
} from '../src/index.ts';

test('canonical event envelope preserves correlation, causation, and Pack provenance', () => {
  const occurredAt = new Date('2026-08-30T08:00:00.000Z');
  const recordedAt = new Date('2026-08-30T08:00:01.000Z');
  const event = createDomainEvent({
    eventId: 'event-1',
    tenantId: 'tenant-1',
    aggregateType: 'crm.case',
    aggregateId: 'treatment-1',
    eventType: 'Treatment.StageChanged',
    eventVersion: 1,
    occurredAt,
    recordedAt,
    actorSubjectId: 'dentist-1',
    correlationId: 'correlation-1',
    causationId: 'command-1',
    packKey: 'dentex',
    packVersion: 2,
    payload: { fromStage: 'INTAKE', toStage: 'IN_PROGRESS' },
    metadata: { source: 'workflow' },
  });

  assert.equal(event.correlationId, 'correlation-1');
  assert.equal(event.causationId, 'command-1');
  assert.equal(event.packKey, 'dentex');
  assert.equal(event.packVersion, 2);
  assert.deepEqual(event.payload, {
    fromStage: 'INTAKE',
    toStage: 'IN_PROGRESS',
  });
});

test('event version and Pack provenance fail closed', () => {
  assert.throws(
    () => createDomainEvent({
      eventId: 'event-2',
      tenantId: 'tenant-1',
      aggregateType: 'crm.case',
      aggregateId: 'treatment-1',
      eventType: 'Treatment.StageChanged',
      eventVersion: 0,
      occurredAt: new Date(),
      actorSubjectId: 'actor-1',
      correlationId: 'correlation-1',
    }),
    (error) =>
      error instanceof DomainEventValidationError
      && error.code === 'DOMAIN_EVENT_VERSION_INVALID',
  );

  assert.throws(
    () => createDomainEvent({
      eventId: 'event-3',
      tenantId: 'tenant-1',
      aggregateType: 'crm.case',
      aggregateId: 'treatment-1',
      eventType: 'Treatment.StageChanged',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: 'actor-1',
      correlationId: 'correlation-1',
      packVersion: 1,
    }),
    /packKey is required/,
  );
});
