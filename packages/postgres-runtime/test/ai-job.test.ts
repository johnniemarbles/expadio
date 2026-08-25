import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  AiJobEvent,
  AiJobRegistration,
} from '@expadio/ai-gateway';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import { PostgresAiJobRepository } from '../src/ai-job.ts';

class Client implements PostgresClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
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

const job: AiJobRegistration = {
  jobId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  intent: {
    invocationId: 'invocation-1',
    tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    operation: 'EXTRACT',
    purpose: 'Extract facts.',
    inputReference: 'object://tenant/input-1',
    promptConfiguration: { key: 'extract', version: 2 },
    governance: {
      requiredResidencyTags: ['eu'],
      requiredComplianceTags: ['regulated'],
      maximumCostMinorUnits: 20,
    },
    idempotencyKey: 'extract:1:v2',
    requestedAt: '2026-08-25T15:00:00.000Z',
  },
  maximumAttempts: 2,
  createdBySubjectId: 'workflow-1',
  createdAt: '2026-08-25T15:00:00.000Z',
  reason: 'Queue extraction.',
  correlationId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  evidenceRefs: ['workflow:event-1'],
};

test('creates a reference-only immutable AI job registration', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 1 });

  const result = await new PostgresAiJobRepository(client).create(job);

  assert.equal(result.status, 'COMMITTED');
  assert.equal(client.calls.length, 1);
  assert.match(client.calls[0]?.text ?? '', /INSERT INTO platform\.ai_jobs/);
  assert.equal(client.calls[0]?.values[14], job.intent.requestedAt);
  assert.deepEqual(client.calls[0]?.values[19], job.evidenceRefs);
});

test('maps an immutable registration from PostgreSQL', async () => {
  const client = new Client();
  client.steps.push({
    rows: [{
      job_id: job.jobId,
      tenant_id: job.intent.tenantId,
      invocation_id: job.intent.invocationId,
      operation: job.intent.operation,
      purpose: job.intent.purpose,
      input_reference: job.intent.inputReference,
      context_reference: null,
      prompt_configuration_key: job.intent.promptConfiguration.key,
      prompt_configuration_version: job.intent.promptConfiguration.version,
      required_residency_tags: job.intent.governance.requiredResidencyTags,
      required_compliance_tags: job.intent.governance.requiredComplianceTags,
      maximum_cost_minor_units: 20,
      maximum_attempts: 2,
      idempotency_key: job.intent.idempotencyKey,
      requested_at: job.intent.requestedAt,
      created_by_subject_id: job.createdBySubjectId,
      created_at: job.createdAt,
      reason: job.reason,
      correlation_id: job.correlationId,
      evidence_refs: job.evidenceRefs,
    }],
    rowCount: 1,
  });

  const result = await new PostgresAiJobRepository(client).findById({
    tenantId: job.intent.tenantId,
    jobId: job.jobId,
  });
  assert.deepEqual(result, job);
  assert.match(client.calls[0]?.text ?? '', /tenant_id = \$1::uuid/);
});

test('maps ordered event history', async () => {
  const client = new Client();
  client.steps.push({
    rows: [{
      event_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      job_id: job.jobId,
      tenant_id: job.intent.tenantId,
      sequence: 1,
      event_type: 'SUCCEEDED',
      occurred_at: '2026-08-25T15:00:01.000Z',
      actor_subject_id: 'worker-1',
      reason: 'Complete extraction.',
      correlation_id: job.correlationId,
      evidence_refs: ['provider:response-1'],
      output_reference: 'object://tenant/output-1',
      confidence: 0.9,
      cost_minor_units: 8,
      failure_code: null,
      next_attempt_at: null,
    }],
    rowCount: 1,
  });

  const events = await new PostgresAiJobRepository(client).listEvents({
    tenantId: job.intent.tenantId,
    jobId: job.jobId,
  });
  assert.equal(events[0]?.type, 'SUCCEEDED');
  assert.equal(
    events[0]?.type === 'SUCCEEDED' ? events[0].outputReference : null,
    'object://tenant/output-1',
  );
  assert.match(client.calls[0]?.text ?? '', /ORDER BY sequence ASC/);
});

test('returns the expected sequence after a database sequence rejection', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 });
  client.steps.push(
    Object.assign(new Error('AI job event sequence must be 1, received 2'), {
      code: 'P0001',
    }),
  );
  client.steps.push({ rows: [], rowCount: 0 });
  client.steps.push({
    rows: [{ expected_sequence: 1 }],
    rowCount: 1,
  });
  const event: AiJobEvent = {
    eventId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    jobId: job.jobId,
    tenantId: job.intent.tenantId,
    sequence: 2,
    type: 'STARTED',
    occurredAt: '2026-08-25T15:00:01.000Z',
    actorSubjectId: 'worker-1',
    reason: 'Start.',
    correlationId: job.correlationId,
    evidenceRefs: ['queue:message-1'],
  };

  const result = await new PostgresAiJobRepository(client).appendEvent(event);
  assert.deepEqual(result, {
    status: 'SEQUENCE_CONFLICT',
    expectedSequence: 1,
  });
  assert.equal(client.calls.length, 4);
});
