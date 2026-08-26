import assert from 'node:assert/strict';
import test from 'node:test';
import type { SensitiveReadAuditEvent } from '@expadio/audit';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import { PostgresSensitiveReadAuditRepository } from '../src/sensitive-read-event.ts';

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

const event: SensitiveReadAuditEvent = {
  eventId: '39100000-0000-0000-0000-000000000001',
  request: {
    requestId: 'read-1',
    tenantId: '39000000-0000-0000-0000-000000000001',
    requestedBySubjectId: 'subject-1',
    resourceReference: { type: 'regulated-record', id: 'record-1' },
    purpose: 'authorized case review',
    legalBasis: 'CONSENT',
    requestedAt: '2026-08-26T00:00:00.000Z',
    correlationId: '39200000-0000-0000-0000-000000000001',
    evidenceRefs: ['consent://1'],
  },
  authorizationDecisionId: 'decision-1',
  authorizationReasonKey: 'POLICY_ALLOWED',
  outcome: 'ALLOWED',
  resultReference: 'result://read/1',
  classifications: ['RESTRICTED'],
  sourceReferences: ['record://1'],
  failureReasonKey: null,
  recordedAt: '2026-08-26T00:00:01.000Z',
};

function row() {
  return {
    event_id: event.eventId,
    request_id: event.request.requestId,
    tenant_id: event.request.tenantId,
    requested_by_subject_id: event.request.requestedBySubjectId,
    resource_type: event.request.resourceReference.type,
    resource_id: event.request.resourceReference.id,
    purpose: event.request.purpose,
    legal_basis: event.request.legalBasis,
    authorization_decision_id: event.authorizationDecisionId,
    authorization_reason_key: event.authorizationReasonKey,
    outcome: event.outcome,
    result_reference: event.resultReference,
    classifications: event.classifications,
    source_references: event.sourceReferences,
    failure_reason_key: event.failureReasonKey,
    requested_at: event.request.requestedAt,
    recorded_at: event.recordedAt,
    correlation_id: event.request.correlationId,
    evidence_refs: event.request.evidenceRefs,
  };
}

test('records a validated reference-only sensitive read event', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 1 });

  const result = await new PostgresSensitiveReadAuditRepository(client).record(event);

  assert.equal(result.recorded, true);
  assert.match(client.calls[0]?.text ?? '', /INSERT INTO platform\.sensitive_read_events/);
  assert.equal(client.calls[0]?.values[11], event.resultReference);
  assert.equal(client.calls[0]?.values.includes('protected-payload'), false);
});

test('loads exact tenant and request audit history', async () => {
  const client = new Client();
  client.steps.push({ rows: [row()], rowCount: 1 });

  const loaded = await new PostgresSensitiveReadAuditRepository(client).findByRequest(
    event.request.tenantId,
    event.request.requestId,
  );

  assert.deepEqual(loaded, event);
  assert.match(client.calls[0]?.text ?? '', /tenant_id = \$1::uuid/);
});

test('treats an exact retry as already recorded', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 });
  client.steps.push({ rows: [row()], rowCount: 1 });

  const result = await new PostgresSensitiveReadAuditRepository(client).record(event);

  assert.equal(result.recorded, false);
  assert.deepEqual(result.event, event);
});

test('rejects invalid allowed outcome before querying PostgreSQL', async () => {
  const client = new Client();

  await assert.rejects(
    new PostgresSensitiveReadAuditRepository(client).record({
      ...event,
      resultReference: null,
      classifications: [],
      sourceReferences: [],
    }),
    /SENSITIVE_READ_AUDIT_EVENT_INVALID/,
  );
  assert.equal(client.calls.length, 0);
});
