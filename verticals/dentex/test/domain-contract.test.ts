import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type { DentexDomainEvent } from '../src/events.ts';
import { DENTEX_VERTICAL_KEY, isDentexDomainEvent } from '../src/index.ts';

const verticalRoot = new URL('..', import.meta.url);

const baseEvent = {
  eventId: 'evt_001',
  tenantId: 'tenant_001',
  organizationId: 'org_001',
  aggregateId: 'treatment_001',
  aggregateType: 'Treatment' as const,
  occurredAt: '2026-08-30T00:00:00.000Z',
  audit: {
    subjectId: 'subject_001',
    correlationId: 'correlation_001',
    source: 'crm' as const,
  },
  decision: {
    decisionTraceId: 'trace_001',
    policyVersion: 'policy-v1',
    workflowBlueprintKey: 'dentex-treatment-v1',
  },
};

test('DENTEX vertical exposes the canonical vertical key', () => {
  assert.equal(DENTEX_VERTICAL_KEY, 'dentex');
});

test('DENTEX domain events carry tenant and organization context', () => {
  const event: DentexDomainEvent = {
    ...baseEvent,
    eventType: 'dentex.treatment.discharged',
    payload: {
      treatmentId: 'treatment_001',
      treatmentReference: 'TX-001',
      patientId: 'patient_001',
      practiceId: 'practice_001',
      dischargedAt: '2026-08-30T00:00:00.000Z',
      followUpRequired: true,
    },
  };

  assert.equal(event.tenantId, 'tenant_001');
  assert.equal(event.organizationId, 'org_001');
  assert.equal(event.audit.source, 'crm');
  assert.equal(event.decision?.decisionTraceId, 'trace_001');
  assert.equal(isDentexDomainEvent(event), true);
});

test('treatment discharge is a domain event, not a direct execution primitive', () => {
  const eventsSource = readFileSync(join(verticalRoot.pathname, 'src/events.ts'), 'utf8');
  assert.match(eventsSource, /dentex\.treatment\.discharged/u);
  assert.doesNotMatch(eventsSource, /CREATE_TASK|SCHEDULE|COMMUNICATE/u);
  assert.doesNotMatch(eventsSource, /sendEmail|sendSms|sendWhatsApp|providerAdapter/u);
});

test('DENTEX P1 remains domain-only without provider or scheduler implementation', () => {
  const domainSource = readFileSync(join(verticalRoot.pathname, 'src/domain.ts'), 'utf8');
  const indexSource = readFileSync(join(verticalRoot.pathname, 'src/index.ts'), 'utf8');
  const combined = `${domainSource}\n${indexSource}`;

  assert.match(combined, /interface Patient/u);
  assert.match(combined, /interface Practice/u);
  assert.match(combined, /interface Provider/u);
  assert.match(combined, /interface Referral/u);
  assert.match(combined, /interface Treatment/u);
  assert.match(combined, /interface Procedure/u);
  assert.match(combined, /interface Tooth/u);
  assert.match(combined, /interface CarePlan/u);
  assert.doesNotMatch(combined, /CREATE_TASK|SCHEDULE|COMMUNICATE/u);
  assert.doesNotMatch(combined, /webhook|adapter|queue|dispatch|scheduler/u);
});
