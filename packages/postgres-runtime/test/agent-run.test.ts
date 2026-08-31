import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  AgentRunEventRecord,
  AgentRunRecord,
} from '@expadio/agent-runtime';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import { PostgresAgentRunRepository } from '../src/agent-run.ts';

class Client implements PostgresClient {
  readonly calls: Array<{
    text: string;
    values: readonly unknown[];
  }> = [];
  readonly steps: Array<SqlQueryResult | Error> = [];

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ) {
    this.calls.push({ text, values });
    const step = this.steps.shift() ?? { rows: [], rowCount: 0 };
    if (step instanceof Error) throw step;
    return step as SqlQueryResult<Row>;
  }
}

const run: AgentRunRecord = {
  runId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  organizationId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  agentId: 'agent-1',
  purpose: 'Prepare a proposal.',
  contextBundleReference: 'context://bundle/1',
  budgetPolicyReference: 'policy://budget/v1',
  idempotencyKey: 'agent-run:1',
  requestedBySubjectId: 'subject-1',
  requestedAt: '2026-08-25T20:00:00.000Z',
  createdAt: '2026-08-25T20:00:00.100Z',
  reason: 'Start governed run.',
  correlationId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  evidenceRefs: ['request://agent-run/1'],
};

const event: AgentRunEventRecord = {
  eventId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  runId: run.runId,
  tenantId: run.tenantId,
  organizationId: run.organizationId,
  sequence: 1,
  eventType: 'STARTED',
  eventReference: 'event://agent-run/1/started',
  occurredAt: '2026-08-25T20:00:01.000Z',
  actorSubjectId: 'subject-1',
  reason: 'Run started.',
  correlationId: run.correlationId,
  evidenceRefs: ['request://agent-run/1'],
  costMinorUnits: null,
};

function runRow() {
  return {
    run_id: run.runId,
    tenant_id: run.tenantId,
    organization_id: run.organizationId,
    agent_id: run.agentId,
    purpose: run.purpose,
    context_bundle_reference: run.contextBundleReference,
    budget_policy_reference: run.budgetPolicyReference,
    idempotency_key: run.idempotencyKey,
    requested_by_subject_id: run.requestedBySubjectId,
    requested_at: run.requestedAt,
    created_at: run.createdAt,
    reason: run.reason,
    correlation_id: run.correlationId,
    evidence_refs: run.evidenceRefs,
  };
}

function eventRow() {
  return {
    event_id: event.eventId,
    run_id: event.runId,
    tenant_id: event.tenantId,
    organization_id: event.organizationId,
    sequence: event.sequence,
    event_type: event.eventType,
    event_reference: event.eventReference,
    occurred_at: event.occurredAt,
    actor_subject_id: event.actorSubjectId,
    reason: event.reason,
    correlation_id: event.correlationId,
    evidence_refs: event.evidenceRefs,
    cost_minor_units: event.costMinorUnits,
  };
}

test('registers an immutable agent run', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 1 });

  const result = await new PostgresAgentRunRepository(client).register(run);

  assert.equal(result.created, true);
  assert.match(client.calls[0]?.text ?? '', /INSERT INTO platform\.agent_runs/);
  assert.equal(client.calls[0]?.values[8], run.requestedAt);
  assert.deepEqual(client.calls[0]?.values[12], run.evidenceRefs);
});

test('loads and validates ordered tenant history', async () => {
  const client = new Client();
  client.steps.push({ rows: [runRow()], rowCount: 1 });
  client.steps.push({ rows: [eventRow()], rowCount: 1 });

  const history = await new PostgresAgentRunRepository(client).load(
    run.tenantId,
    run.runId,
  );

  assert.deepEqual(history, { run, events: [event] });
  assert.match(client.calls[0]?.text ?? '', /tenant_id = \$1::uuid/);
  assert.match(client.calls[1]?.text ?? '', /ORDER BY sequence ASC/);
});

test('treats an identical event retry as already appended', async () => {
  const client = new Client();
  client.steps.push({ rows: [eventRow()], rowCount: 1 });

  const result = await new PostgresAgentRunRepository(client).append(event);

  assert.equal(result.appended, false);
  assert.deepEqual(result.event, event);
  assert.equal(client.calls.length, 1);
});

test('maps a database sequence rejection to a stable conflict', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 });
  client.steps.push(
    Object.assign(
      new Error('Agent run event sequence must be 1, received 2'),
      { code: 'P0001' },
    ),
  );
  client.steps.push({ rows: [], rowCount: 0 });
  client.steps.push({
    rows: [{ expected_sequence: 1 }],
    rowCount: 1,
  });

  await assert.rejects(
    () =>
      new PostgresAgentRunRepository(client).append({
        ...event,
        sequence: 2,
      }),
    /AGENT_RUN_EVENT_SEQUENCE_CONFLICT:expected=1/,
  );
  assert.equal(client.calls.length, 4);
});
