import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresVoiceTransportRepository } from '../src/voice-transport.ts';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';

class ScriptedClient implements PostgresClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly responses: SqlQueryResult[] = [];

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    return (this.responses.shift() ?? { rows: [], rowCount: 0 }) as SqlQueryResult<Row>;
  }
}

const row = {
  call_id: '11111111-1111-1111-1111-111111111111',
  tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  organization_id: null,
  connector_key: 'voice-primary',
  provider_call_id: null,
  direction: 'OUTBOUND',
  from_address: '+15550000001',
  to_address: '+15550000002',
  from_subject_id: null,
  to_subject_id: 'subject-1',
  state: 'REQUESTED',
  requested_at: '2026-08-25T05:00:00.000Z',
  answered_at: null,
  ended_at: null,
  recording_ref: null,
  transcript_ref: null,
  conversation_id: null,
  agent_id: null,
  human_handoff_requested_at: null,
  last_reason_code: null,
  updated_at: '2026-08-25T05:00:00.000Z',
};

test('create persists a REQUESTED voice session and maps participants', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [row], rowCount: 1 });

  const result = await new PostgresVoiceTransportRepository(client).create({
    callId: row.call_id,
    tenantId: row.tenant_id,
    connectorKey: row.connector_key,
    direction: 'OUTBOUND',
    from: { address: row.from_address },
    to: { address: row.to_address, subjectId: 'subject-1' },
    requestedAt: row.requested_at,
  });

  assert.equal(result.state, 'REQUESTED');
  assert.equal(result.to.subjectId, 'subject-1');
  assert.match(client.calls[0]?.text ?? '', /communication_voice_sessions/);
});

test('applyTransition locks, updates transport evidence, and appends an event', async () => {
  const client = new ScriptedClient();
  client.responses.push(
    { rows: [row], rowCount: 1 },
    { rows: [{ exists: false }], rowCount: 1 },
    {
      rows: [{
        ...row,
        provider_call_id: 'provider-call-1',
        state: 'ANSWERED',
        answered_at: '2026-08-25T05:01:00.000Z',
        recording_ref: 'recording://1',
        updated_at: '2026-08-25T05:01:00.000Z',
      }],
      rowCount: 1,
    },
    { rows: [], rowCount: 1 },
  );

  const result = await new PostgresVoiceTransportRepository(client).applyTransition({
    tenantId: row.tenant_id,
    callId: row.call_id,
    transition: {
      from: 'REQUESTED',
      to: 'ANSWERED',
      occurredAt: '2026-08-25T05:01:00.000Z',
      providerEventId: 'voice-event-1',
      providerCallId: 'provider-call-1',
      recordingRef: 'recording://1',
    },
  });

  assert.equal(result.applied, true);
  assert.equal(result.session.state, 'ANSWERED');
  assert.equal(result.session.providerCallId, 'provider-call-1');
  assert.equal(result.session.recordingRef, 'recording://1');
  assert.match(client.calls[0]?.text ?? '', /FOR UPDATE/);
  assert.match(client.calls[3]?.text ?? '', /communication_voice_events/);
});

test('duplicate provider events are idempotent', async () => {
  const client = new ScriptedClient();
  client.responses.push(
    { rows: [row], rowCount: 1 },
    { rows: [{ exists: true }], rowCount: 1 },
  );

  const result = await new PostgresVoiceTransportRepository(client).applyTransition({
    tenantId: row.tenant_id,
    callId: row.call_id,
    transition: {
      from: 'REQUESTED',
      to: 'RINGING',
      occurredAt: '2026-08-25T05:00:30.000Z',
      providerEventId: 'voice-event-duplicate',
    },
  });

  assert.equal(result.applied, false);
  assert.equal(client.calls.length, 2);
});

test('stale from-state fails before snapshot mutation', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [{ ...row, state: 'RINGING' }], rowCount: 1 });

  await assert.rejects(
    () => new PostgresVoiceTransportRepository(client).applyTransition({
      tenantId: row.tenant_id,
      callId: row.call_id,
      transition: {
        from: 'REQUESTED',
        to: 'ANSWERED',
        occurredAt: '2026-08-25T05:01:00.000Z',
      },
    }),
    /VOICE_CALL_STALE_FROM_STATE:REQUESTED->RINGING/,
  );
});
