import assert from 'node:assert/strict';
import test from 'node:test';
import {
  credentialReference,
  type CredentialRotationEvent,
} from '@expadio/provider-registry';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import { PostgresCredentialRotationRepository } from '../src/credential-rotation.ts';

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

const event: CredentialRotationEvent = {
  eventId: '38100000-0000-0000-0000-000000000001',
  rotationReference: 'rotation://tenant-1/storage/1',
  sequence: 1,
  requestId: 'request-1',
  tenantId: '38000000-0000-0000-0000-000000000001',
  requestedBySubjectId: 'security-admin-1',
  connectorKey: 'storage-primary',
  currentCredentialReference: credentialReference('vault://tenant-1/storage/v1'),
  replacementCredentialReference: credentialReference('vault://tenant-1/storage/v2'),
  eventType: 'STAGED',
  authorizationDecisionId: 'decision-1',
  reason: 'scheduled rotation',
  occurredAt: '2026-08-26T00:00:00.000Z',
  correlationId: '38200000-0000-0000-0000-000000000001',
  evidenceRefs: ['change://credential/1'],
};

function row(candidate: CredentialRotationEvent = event) {
  return {
    event_id: candidate.eventId,
    rotation_reference: candidate.rotationReference,
    sequence: candidate.sequence,
    request_id: candidate.requestId,
    tenant_id: candidate.tenantId,
    requested_by_subject_id: candidate.requestedBySubjectId,
    connector_key: candidate.connectorKey,
    current_credential_reference: candidate.currentCredentialReference,
    replacement_credential_reference: candidate.replacementCredentialReference,
    event_type: candidate.eventType,
    authorization_decision_id: candidate.authorizationDecisionId,
    reason: candidate.reason,
    occurred_at: candidate.occurredAt,
    correlation_id: candidate.correlationId,
    evidence_refs: candidate.evidenceRefs,
  };
}

test('appends the exact next immutable rotation event', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 });
  client.steps.push({ rows: [{ expected_sequence: 1 }], rowCount: 1 });
  client.steps.push({ rows: [], rowCount: 1 });

  const result = await new PostgresCredentialRotationRepository(client).append(event);

  assert.equal(result.appended, true);
  assert.match(client.calls[2]?.text ?? '', /INSERT INTO platform\.credential_rotation_events/);
  assert.equal(client.calls[2]?.values[7], event.currentCredentialReference);
  assert.equal(client.calls[2]?.values.includes('raw-secret'), false);
});

test('loads and validates ordered tenant rotation history', async () => {
  const activated: CredentialRotationEvent = {
    ...event,
    eventId: '38100000-0000-0000-0000-000000000002',
    sequence: 2,
    eventType: 'ACTIVATED',
    occurredAt: '2026-08-26T00:01:00.000Z',
  };
  const client = new Client();
  client.steps.push({ rows: [row(event), row(activated)], rowCount: 2 });

  const history = await new PostgresCredentialRotationRepository(client).load(
    event.tenantId,
    event.rotationReference,
  );

  assert.deepEqual(history, [event, activated]);
  assert.match(client.calls[0]?.text ?? '', /ORDER BY sequence ASC/);
});

test('treats an identical event retry as already appended', async () => {
  const client = new Client();
  client.steps.push({ rows: [row()], rowCount: 1 });

  const result = await new PostgresCredentialRotationRepository(client).append(event);

  assert.equal(result.appended, false);
  assert.equal(client.calls.length, 1);
});

test('rejects an out-of-sequence event before insert', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 });
  client.steps.push({ rows: [{ expected_sequence: 1 }], rowCount: 1 });

  await assert.rejects(
    new PostgresCredentialRotationRepository(client).append({
      ...event,
      eventId: '38100000-0000-0000-0000-000000000003',
      sequence: 2,
      eventType: 'ACTIVATED',
    }),
    /CREDENTIAL_ROTATION_EVENT_SEQUENCE_CONFLICT:expected=1/,
  );
  assert.equal(client.calls.length, 2);
});
