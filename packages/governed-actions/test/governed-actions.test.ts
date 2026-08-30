import assert from 'node:assert/strict';
import test from 'node:test';
import { createDomainEvent } from '@expadio/domain-events';
import {
  governedActionIdempotencyKey,
  resolveGovernedAction,
} from '../src/index.ts';

const event = createDomainEvent({
  eventId: '11111111-1111-4111-8111-111111111111',
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  aggregateType: 'crm.case',
  aggregateId: 'treatment-1',
  eventType: 'Treatment.Discharged',
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
      ruleKey: 'dentex.discharge.follow-up',
      eventType: 'Treatment.Discharged',
      executorClass: 'COMMUNICATE',
      actionKey: 'patient.follow_up',
      enabled: true,
      policyKeys: ['patient-contactable'],
      configuration: { channel: 'email' },
    },
    {
      allowed: true,
      policyKeys: ['patient-contactable'],
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
