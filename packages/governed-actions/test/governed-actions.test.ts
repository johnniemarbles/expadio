import assert from 'node:assert/strict';
import test from 'node:test';
import { createDomainEvent } from '@expadio/domain-events';
import {
  governedActionIdempotencyKey,
  resolveGovernedAction,
  materializeGovernedActionConfiguration,
} from '../src/index.ts';

const event = createDomainEvent({
  eventId: '11111111-1111-4111-8111-111111111111',
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  aggregateType: 'crm.case',
  aggregateId: 'service-request-1',
  eventType: 'ServiceRequest.Completed',
  eventVersion: 1,
  occurredAt: new Date('2026-08-30T08:00:00.000Z'),
  recordedAt: new Date('2026-08-30T08:00:01.000Z'),
  actorSubjectId: 'reviewer-1',
  correlationId: 'journey-1',
  payload: { stage: 'RESOLVED' },
});

test('allowed policy resolves a durable intent without executing a capability', () => {
  const evaluatedAt = new Date('2026-08-30T08:00:02.000Z');
  const resolved = resolveGovernedAction(
    event,
    {
      ruleKey: 'acme-corp.completed.follow-up',
      eventType: 'ServiceRequest.Completed',
      executorClass: 'COMMUNICATE',
      actionKey: 'client.follow_up',
      enabled: true,
      policyKeys: ['client-contactable'],
      configuration: { channel: 'email' },
    },
    {
      allowed: true,
      policyKeys: ['client-contactable'],
      evidenceRefs: ['consent:123'],
      reasonCode: 'ALLOWED',
      evaluatedAt,
    },
  );

  assert.ok(resolved.matched && resolved.allowed);
  if (!resolved.matched || !resolved.allowed) throw new Error('expected allowed intent');

  assert.equal(resolved.intent.executorClass, 'COMMUNICATE');
  assert.equal(resolved.intent.actionKey, 'patient.follow_up');
  assert.equal(resolved.intent.sourceEventId, event.eventId);
  assert.equal(resolved.intent.causationId, event.eventId);
  assert.equal(resolved.intent.correlationId, event.correlationId);
  assert.equal(
    resolved.intent.idempotencyKey,
    '11111111-1111-4111-8111-111111111111:dentex.discharge.follow-up:COMMUNICATE',
  );
  assert.deepEqual(resolved.intent.configuration, { channel: 'email' });
});

test('denied policy creates no executable intent', () => {
  const resolved = resolveGovernedAction(
    event,
    {
      ruleKey: 'dentex.discharge.follow-up',
      eventType: 'Treatment.Discharged',
      executorClass: 'COMMUNICATE',
      actionKey: 'patient.follow_up',
      enabled: true,
      policyKeys: ['patient-contactable'],
      configuration: {},
    },
    {
      allowed: false,
      policyKeys: ['patient-contactable'],
      evidenceRefs: ['suppression:patient'],
      reasonCode: 'SUPPRESSED',
      evaluatedAt: new Date(),
    },
  );

  assert.deepEqual(resolved, {
    matched: true,
    allowed: false,
    reasonCode: 'SUPPRESSED',
  });
});

test('idempotency key is deterministic by event, rule, and executor', () => {
  assert.equal(
    governedActionIdempotencyKey({
      eventId: event.eventId,
      ruleKey: 'rule.a',
      executorClass: 'AI_ACTION',
    }),
    governedActionIdempotencyKey({
      eventId: event.eventId,
      ruleKey: 'rule.a',
      executorClass: 'AI_ACTION',
    }),
  );
});


test('an allowed decision cannot omit a policy required by the rule', () => {
  const resolved = resolveGovernedAction(
    event,
    {
      ruleKey: 'dentex.discharge.follow-up',
      eventType: 'Treatment.Discharged',
      executorClass: 'COMMUNICATE',
      actionKey: 'patient.follow_up',
      enabled: true,
      policyKeys: ['patient-contactable', 'quiet-hours'],
      configuration: {},
    },
    {
      allowed: true,
      policyKeys: ['patient-contactable'],
      evidenceRefs: ['consent:active'],
      reasonCode: 'ALLOWED',
      evaluatedAt: new Date(),
    },
  );

  assert.deepEqual(resolved, {
    matched: true,
    allowed: false,
    reasonCode: 'POLICY_EVALUATION_INCOMPLETE',
  });
});


test('action configuration materializes event and aggregate bindings without JSONPath', () => {
  const materialized = materializeGovernedActionConfiguration(
    {
      triggerKey: { kind: 'LITERAL', value: 'patient.follow_up' },
      recipient: {
        email: { kind: 'AGGREGATE_FIELD', key: 'patientEmail' },
      },
      variables: {
        patientName: { kind: 'AGGREGATE_FIELD', key: 'patientName' },
        stage: { kind: 'EVENT_PAYLOAD', key: 'stage' },
      },
    },
    {
      event,
      aggregateFields: {
        patientEmail: 'patient@example.test',
        patientName: 'Jane',
      },
    },
  );

  assert.deepEqual(materialized, {
    triggerKey: 'patient.follow_up',
    recipient: { email: 'patient@example.test' },
    variables: {
      patientName: 'Jane',
      stage: 'RESOLVED',
    },
  });
});

test('required bindings fail closed and top-level keys forbid JSONPath syntax', () => {
  assert.throws(
    () => materializeGovernedActionConfiguration(
      { email: { kind: 'AGGREGATE_FIELD', key: 'patient.email' } },
      { event, aggregateFields: { patientEmail: 'patient@example.test' } },
    ),
    /one top-level field key/,
  );

  assert.throws(
    () => materializeGovernedActionConfiguration(
      { email: { kind: 'AGGREGATE_FIELD', key: 'patientEmail' } },
      { event, aggregateFields: {} },
    ),
    /No value is available/,
  );
});


test('required aggregate bindings reject explicit null values', () => {
  assert.throws(
    () => materializeGovernedActionConfiguration(
      { email: { kind: 'AGGREGATE_FIELD', key: 'contactEmail' } },
      { event, aggregateFields: { contactEmail: null } },
    ),
    /No value is available/,
  );
});
