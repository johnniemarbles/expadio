import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CommunicationConsentRepository,
  CommunicationDispatchResult,
  CommunicationSuppressionRepository,
  CommunicationTemplateRepository,
} from '@expadio/communication';
import type { CommunicationDispatchPort } from '@expadio/communication/dispatch';
import type { GovernedActionIntent } from './index.ts';
import { executeCommunicateActionIntent } from './communicate-executor.ts';

const actionIntent: GovernedActionIntent = {
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sourceEventId: '11111111-1111-4111-8111-111111111111',
  sourceEventType: 'Treatment.Discharged',
  aggregateType: 'crm.case',
  aggregateId: 'treatment-1',
  ruleKey: 'dentex.discharge.follow-up',
  executorClass: 'COMMUNICATE',
  actionKey: 'patient.follow_up',
  idempotencyKey:
    '11111111-1111-4111-8111-111111111111:dentex.discharge.follow-up:COMMUNICATE',
  correlationId: 'journey-1',
  causationId: '11111111-1111-4111-8111-111111111111',
  requestedBySubjectId: 'reviewer-1',
  requestedAt: new Date('2026-08-30T10:00:00.000Z'),
  configuration: {
    triggerKey: 'patient.follow_up',
    recipient: { email: 'patient@example.test' },
    variables: { patientName: 'Jane' },
    purpose: 'transactional',
    consentRequired: false,
    channel: 'email',
    locale: 'en',
    capabilityKey: 'communication.email.send',
  },
  policyDecision: {
    allowed: true,
    policyKeys: ['patient-contactable'],
    evidenceRefs: ['patient:email'],
    reasonCode: 'ALLOWED',
    evaluatedAt: new Date('2026-08-30T10:00:00.000Z'),
  },
};

function consent(granted = true): CommunicationConsentRepository {
  return {
    async record() {
      throw new Error('not used');
    },
    async resolveEffective() {
      return {
        granted,
        scope: granted ? 'TENANT' : 'NONE',
        event: null,
      };
    },
  };
}

function suppression(active = false): CommunicationSuppressionRepository {
  return {
    async findActive() {
      return active
        ? {
            suppressionId: 'suppression-1',
            tenantId: actionIntent.tenantId,
            recipientKey: 'patient@example.test',
            channel: 'email',
            reason: 'OPT_OUT',
            recordedAt: '2026-08-30T09:00:00.000Z',
          }
        : null;
    },
    async add() {
      throw new Error('not used');
    },
    async revoke() {
      throw new Error('not used');
    },
  };
}

function templates(): CommunicationTemplateRepository {
  return {
    async resolveActive() {
      return {
        matchedScope: 'PLATFORM',
        template: {
          templateId: 'follow-up-template',
          scope: { kind: 'PLATFORM' },
          key: {
            triggerKey: 'patient.follow_up',
            channel: 'email',
            locale: 'en',
          },
          content: {
            format: 'TEXT',
            subject: 'Follow-up',
            body: 'Hello {{patientName}}',
          },
          requiredVariables: ['patientName'],
          defaultVariables: {},
          version: 1,
          status: 'ACTIVE',
          createdAt: '2026-08-30T00:00:00.000Z',
          updatedAt: '2026-08-30T00:00:00.000Z',
        },
      };
    },
  };
}

test('COMMUNICATE executor preserves governed idempotency and stops at dispatch port', async () => {
  const calls: unknown[] = [];
  const expected: CommunicationDispatchResult = {
    state: 'QUEUED',
    reasonCode: 'OK',
    messageId: null,
    providerKey: 'routing-runtime',
    queuedAt: '2026-08-30T10:00:01.000Z',
  };
  const dispatch: CommunicationDispatchPort = {
    async dispatch(input) {
      calls.push(input);
      return expected;
    },
  };

  const result = await executeCommunicateActionIntent(actionIntent, {
    compliance: {
      consent: consent(),
      suppression: suppression(),
    },
    templates: templates(),
    dispatch,
  });

  assert.equal(result.executed, true);
  if (!result.executed) throw new Error('expected execution');

  assert.equal(calls.length, 1);
  assert.equal(
    result.communicationIntent.idempotencyKey,
    actionIntent.idempotencyKey,
  );
  assert.equal(
    result.preparedDispatch.idempotencyKey,
    actionIntent.idempotencyKey,
  );
  assert.equal(result.preparedDispatch.triggerKey, 'patient.follow_up');
  assert.equal(result.preparedDispatch.channel, 'email');
  assert.equal(
    result.preparedDispatch.routing.capabilityKey,
    'communication.email.send',
  );
  assert.deepEqual(result.dispatch, expected);
});

test('suppression refuses before dispatch', async () => {
  let dispatched = false;
  const result = await executeCommunicateActionIntent(actionIntent, {
    compliance: {
      consent: consent(),
      suppression: suppression(true),
    },
    templates: templates(),
    dispatch: {
      async dispatch() {
        dispatched = true;
        throw new Error('must not dispatch');
      },
    },
  });

  assert.deepEqual(result, {
    executed: false,
    state: 'REFUSED',
    reasonCode: 'SUPPRESSED',
    reason: 'Recipient is suppressed for email: OPT_OUT.',
  });
  assert.equal(dispatched, false);
});

test('missing template refuses before dispatch', async () => {
  let dispatched = false;
  const result = await executeCommunicateActionIntent(actionIntent, {
    compliance: {
      consent: consent(),
      suppression: suppression(),
    },
    templates: {
      async resolveActive() {
        return { matchedScope: 'NONE', template: null };
      },
    },
    dispatch: {
      async dispatch() {
        dispatched = true;
        throw new Error('must not dispatch');
      },
    },
  });

  assert.equal(result.executed, false);
  if (result.executed) throw new Error('expected refusal');
  assert.equal(result.reasonCode, 'TEMPLATE_MISSING');
  assert.equal(dispatched, false);
});

test('wrong executor class is refused without touching communications', async () => {
  const result = await executeCommunicateActionIntent(
    { ...actionIntent, executorClass: 'AI_ACTION' },
    {
      compliance: {
        consent: consent(),
        suppression: suppression(),
      },
      templates: templates(),
      dispatch: {
        async dispatch() {
          throw new Error('must not dispatch');
        },
      },
    },
  );

  assert.equal(result.executed, false);
  if (result.executed) throw new Error('expected refusal');
  assert.equal(result.reasonCode, 'WRONG_EXECUTOR_CLASS');
});
