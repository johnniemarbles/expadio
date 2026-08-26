import assert from 'node:assert/strict';
import test from 'node:test';
import type { CredentialLeaseAuditEvent } from '@expadio/provider-registry';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import { PostgresCredentialLeaseAuditRepository } from '../src/credential-lease-event.ts';

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

const event: CredentialLeaseAuditEvent = {
  eventId: '37100000-0000-0000-0000-000000000001',
  request: {
    requestId: 'request-1',
    tenantId: '37000000-0000-0000-0000-000000000001',
    requestedBySubjectId: 'subject-1',
    connectorKey: 'storage-primary',
    purpose: 'object.write',
    requestedAt: '2026-08-26T00:00:00.000Z',
    correlationId: '37200000-0000-0000-0000-000000000001',
    evidenceRefs: ['approval://credential/1'],
  },
  credentialReference: 'vault://tenant-1/storage' as CredentialLeaseAuditEvent['credentialReference'],
  authorizationDecisionId: 'decision-1',
  authorizationReasonKey: 'POLICY_ALLOWED',
  outcome: 'ISSUED',
  leaseReference: 'lease://1',
  issuerAuditReference: 'audit://issuer/1',
  failureReasonKey: null,
  issuedAt: '2026-08-26T00:00:01.000Z',
  expiresAt: '2026-08-26T00:05:01.000Z',
  recordedAt: '2026-08-26T00:00:02.000Z',
};

function row() {
  return {
    event_id: event.eventId,
    request_id: event.request.requestId,
    tenant_id: event.request.tenantId,
    requested_by_subject_id: event.request.requestedBySubjectId,
    connector_key: event.request.connectorKey,
    credential_reference: event.credentialReference,
    purpose: event.request.purpose,
    authorization_decision_id: event.authorizationDecisionId,
    authorization_reason_key: event.authorizationReasonKey,
    outcome: event.outcome,
    lease_reference: event.leaseReference,
    issuer_audit_reference: event.issuerAuditReference,
    failure_reason_key: event.failureReasonKey,
    requested_at: event.request.requestedAt,
    issued_at: event.issuedAt,
    expires_at: event.expiresAt,
    recorded_at: event.recordedAt,
    correlation_id: event.request.correlationId,
    evidence_refs: event.request.evidenceRefs,
  };
}

test('records an immutable credential lease event without secret material', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 1 });

  const result = await new PostgresCredentialLeaseAuditRepository(client).record(event);

  assert.equal(result.recorded, true);
  assert.match(client.calls[0]?.text ?? '', /INSERT INTO platform\.credential_lease_events/);
  assert.equal(client.calls[0]?.values[5], 'vault://tenant-1/storage');
  assert.equal(client.calls[0]?.values.includes('secret-value'), false);
});

test('loads by exact tenant and request', async () => {
  const client = new Client();
  client.steps.push({ rows: [row()], rowCount: 1 });

  const loaded = await new PostgresCredentialLeaseAuditRepository(client).findByRequest({
    tenantId: event.request.tenantId,
    requestId: event.request.requestId,
  });

  assert.deepEqual(loaded, event);
  assert.match(client.calls[0]?.text ?? '', /tenant_id = \$1::uuid/);
});

test('treats an exact retry as already recorded', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 });
  client.steps.push({ rows: [row()], rowCount: 1 });

  const result = await new PostgresCredentialLeaseAuditRepository(client).record(event);

  assert.equal(result.recorded, false);
  assert.deepEqual(result.event, event);
});

test('rejects an overlong lease before querying PostgreSQL', async () => {
  const client = new Client();

  await assert.rejects(
    new PostgresCredentialLeaseAuditRepository(client).record({
      ...event,
      expiresAt: '2026-08-26T00:15:02.000Z',
    }),
    /CREDENTIAL_LEASE_EVENT_INVALID/,
  );
  assert.equal(client.calls.length, 0);
});
