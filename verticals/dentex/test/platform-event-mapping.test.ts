import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type { DentexDomainEvent } from '../src/events.ts';
import {
  DentexPlatformEventMappingError,
  dentexDomainEventIdempotencyKey,
  toDentexPlatformDomainEvent,
} from '../src/platform-events.ts';

const verticalRoot = new URL('..', import.meta.url);

const treatmentDischargedEvent: DentexDomainEvent = {
  eventId: 'evt_001',
  eventType: 'dentex.treatment.discharged',
  tenantId: 'tenant_001',
  organizationId: 'org_001',
  aggregateId: 'treatment_001',
  aggregateType: 'Treatment',
  occurredAt: '2026-08-30T00:00:00.000Z',
  audit: {
    subjectId: 'subject_001',
    correlationId: 'correlation_001',
    source: 'crm',
  },
  decision: {
    decisionTraceId: 'trace_001',
    policyVersion: 'policy-v1',
    workflowBlueprintKey: 'dentex-treatment-v1',
  },
  payload: {
    treatmentId: 'treatment_001',
    treatmentReference: 'TX-001',
    patientId: 'patient_001',
    practiceId: 'practice_001',
    dischargedAt: '2026-08-30T00:00:00.000Z',
    followUpRequired: true,
  },
};

test('DENTEX mapper emits a platform domain-event envelope', () => {
  const envelope = toDentexPlatformDomainEvent(treatmentDischargedEvent);

  assert.equal(envelope.verticalKey, 'dentex');
  assert.equal(envelope.eventType, 'dentex.treatment.discharged');
  assert.equal(envelope.tenantId, 'tenant_001');
  assert.equal(envelope.organizationId, 'org_001');
  assert.equal(envelope.aggregateType, 'Treatment');
  assert.equal(envelope.aggregateId, 'treatment_001');
  assert.equal(envelope.correlationId, 'correlation_001');
  assert.equal(envelope.decisionTraceId, 'trace_001');
  assert.equal(envelope.metadata.policyVersion, 'policy-v1');
  assert.equal(envelope.metadata.workflowBlueprintKey, 'dentex-treatment-v1');
});

test('DENTEX mapper derives stable idempotency keys from tenant, type and event id', () => {
  assert.equal(
    dentexDomainEventIdempotencyKey(treatmentDischargedEvent),
    'dentex:tenant_001:dentex.treatment.discharged:evt_001',
  );
  assert.equal(
    toDentexPlatformDomainEvent(treatmentDischargedEvent).idempotencyKey,
    'dentex:tenant_001:dentex.treatment.discharged:evt_001',
  );
});

test('DENTEX mapper falls back to event id when audit correlation is absent', () => {
  const envelope = toDentexPlatformDomainEvent({
    ...treatmentDischargedEvent,
    audit: { source: 'system' },
  });

  assert.equal(envelope.correlationId, 'evt_001');
  assert.equal(envelope.subjectId, undefined);
});

test('DENTEX mapper fails closed when required platform event fields are blank', () => {
  assert.throws(
    () => toDentexPlatformDomainEvent({ ...treatmentDischargedEvent, tenantId: '   ' }),
    (error: unknown) => error instanceof DentexPlatformEventMappingError && error.code === 'TENANTID_REQUIRED',
  );
});

test('DENTEX platform mapping remains domain-event only', () => {
  const mapperSource = readFileSync(join(verticalRoot.pathname, 'src/platform-events.ts'), 'utf8');
  assert.doesNotMatch(mapperSource, /CREATE_TASK|SCHEDULE|COMMUNICATE/u);
  assert.doesNotMatch(mapperSource, /sendEmail|sendSms|sendWhatsApp|providerAdapter/u);
  assert.doesNotMatch(mapperSource, /queue|dispatch|scheduler|webhook/u);
});
