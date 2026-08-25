import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentRunHistoryError,
  validateAgentRunHistory,
  type AgentRunEventRecord,
  type AgentRunRecord,
} from '../src/index.ts';

const run: AgentRunRecord = {
  runId: 'run-1',
  tenantId: 'tenant-1',
  agentId: 'agent-1',
  purpose: 'Prepare an authorized account proposal.',
  contextBundleReference: 'context://bundle/1',
  budgetPolicyReference: 'policy://agent-budget/v1',
  idempotencyKey: 'agent-run:1',
  requestedBySubjectId: 'subject-1',
  requestedAt: '2026-08-25T20:00:00.000Z',
  createdAt: '2026-08-25T20:00:00.100Z',
  reason: 'Start a governed agent run.',
  correlationId: 'correlation-1',
  evidenceRefs: ['request://agent-run/1'],
};

function event(
  sequence: number,
  eventType: AgentRunEventRecord['eventType'],
  overrides: Partial<AgentRunEventRecord> = {},
): AgentRunEventRecord {
  return {
    eventId: 'event-' + sequence,
    runId: run.runId,
    tenantId: run.tenantId,
    sequence,
    eventType,
    eventReference: 'event://run/1/' + sequence,
    occurredAt: '2026-08-25T20:00:0' + sequence + '.000Z',
    actorSubjectId: 'subject-1',
    reason: 'Record governed run progress.',
    correlationId: run.correlationId,
    evidenceRefs: ['evidence://run/1/' + sequence],
    costMinorUnits: null,
    ...overrides,
  };
}

test('accepts a contiguous tenant-bound run history', () => {
  const history = validateAgentRunHistory({
    run,
    events: [
      event(1, 'STARTED'),
      event(2, 'CONTEXT_AUTHORIZED'),
      event(3, 'BUDGET_RESERVED', { costMinorUnits: 7 }),
      event(4, 'PROPOSAL_CREATED'),
      event(5, 'APPROVED'),
      event(6, 'SUCCEEDED'),
    ],
  });

  assert.equal(history.events.length, 6);
  assert.equal(history.events[5]?.eventType, 'SUCCEEDED');
});

test('rejects cross-tenant or cross-correlation events', () => {
  assert.throws(
    () =>
      validateAgentRunHistory({
        run,
        events: [
          event(1, 'STARTED', { tenantId: 'tenant-2' }),
        ],
      }),
    (error: unknown) =>
      error instanceof AgentRunHistoryError
      && error.code === 'AGENT_RUN_EVENT_IDENTITY_MISMATCH',
  );
});

test('requires a contiguous event sequence starting with STARTED', () => {
  assert.throws(
    () =>
      validateAgentRunHistory({
        run,
        events: [
          event(1, 'CONTEXT_AUTHORIZED'),
        ],
      }),
    (error: unknown) =>
      error instanceof AgentRunHistoryError
      && error.code === 'AGENT_RUN_STARTED_EVENT_REQUIRED',
  );

  assert.throws(
    () =>
      validateAgentRunHistory({
        run,
        events: [
          event(1, 'STARTED'),
          event(3, 'SUCCEEDED'),
        ],
      }),
    (error: unknown) =>
      error instanceof AgentRunHistoryError
      && error.code === 'AGENT_RUN_EVENT_SEQUENCE_INVALID',
  );
});

test('rejects events after a terminal outcome', () => {
  assert.throws(
    () =>
      validateAgentRunHistory({
        run,
        events: [
          event(1, 'STARTED'),
          event(2, 'FAILED'),
          event(3, 'BUDGET_RESERVED'),
        ],
      }),
    (error: unknown) =>
      error instanceof AgentRunHistoryError
      && error.code === 'AGENT_RUN_EVENT_AFTER_TERMINAL',
  );
});

test('rejects negative event cost', () => {
  assert.throws(
    () =>
      validateAgentRunHistory({
        run,
        events: [
          event(1, 'STARTED', { costMinorUnits: -1 }),
        ],
      }),
    (error: unknown) =>
      error instanceof AgentRunHistoryError
      && error.code === 'AGENT_RUN_EVENT_INVALID',
  );
});
