import {
  assertVoiceCallTransition,
  type VoiceCallDirection,
  type VoiceCallState,
  type VoiceTransportSession,
} from '@expadio/communication/voice-transport';
import type {
  ApplyVoiceTransportTransitionInput,
  ApplyVoiceTransportTransitionResult,
  CreateVoiceTransportSessionInput,
  VoiceTransportRepository,
} from '@expadio/communication/voice-transport-repository';
import type { PostgresClient } from './index.ts';

interface VoiceSessionRow {
  readonly call_id: string;
  readonly tenant_id: string;
  readonly organization_id: string | null;
  readonly connector_key: string;
  readonly provider_call_id: string | null;
  readonly direction: VoiceCallDirection;
  readonly from_address: string;
  readonly to_address: string;
  readonly from_subject_id: string | null;
  readonly to_subject_id: string | null;
  readonly state: VoiceCallState;
  readonly requested_at: Date | string;
  readonly answered_at: Date | string | null;
  readonly ended_at: Date | string | null;
  readonly recording_ref: string | null;
  readonly transcript_ref: string | null;
  readonly conversation_id: string | null;
  readonly agent_id: string | null;
  readonly human_handoff_requested_at: Date | string | null;
  readonly last_reason_code: string | null;
  readonly updated_at: Date | string;
}

const VOICE_COLUMNS = `call_id, tenant_id, organization_id, connector_key,
  provider_call_id, direction, from_address, to_address, from_subject_id,
  to_subject_id, state, requested_at, answered_at, ended_at, recording_ref,
  transcript_ref, conversation_id, agent_id, human_handoff_requested_at,
  last_reason_code, updated_at`;

export class PostgresVoiceTransportRepository implements VoiceTransportRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async create(input: CreateVoiceTransportSessionInput): Promise<VoiceTransportSession> {
    const result = await this.#client.query<VoiceSessionRow>(
      `INSERT INTO platform.communication_voice_sessions (
         call_id, tenant_id, organization_id, connector_key, provider_call_id,
         direction, from_address, to_address, from_subject_id, to_subject_id,
         state, requested_at, conversation_id, agent_id
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10,
         'REQUESTED', $11, $12::uuid, $13
       ) RETURNING ${VOICE_COLUMNS}`,
      [
        input.callId,
        input.tenantId,
        input.organizationId ?? null,
        input.connectorKey,
        input.providerCallId ?? null,
        input.direction,
        input.from.address,
        input.to.address,
        input.from.subjectId ?? null,
        input.to.subjectId ?? null,
        input.requestedAt,
        input.conversationId ?? null,
        input.agentId ?? null,
      ],
    );
    return mapRequired(result.rows[0]);
  }

  async findByCallId(input: {
    readonly tenantId: string;
    readonly callId: string;
  }): Promise<VoiceTransportSession | null> {
    const result = await this.#client.query<VoiceSessionRow>(
      `SELECT ${VOICE_COLUMNS}
         FROM platform.communication_voice_sessions
        WHERE tenant_id = $1::uuid AND call_id = $2::uuid`,
      [input.tenantId, input.callId],
    );
    return result.rows[0] === undefined ? null : mapSession(result.rows[0]);
  }

  async findByProviderCallId(input: {
    readonly tenantId: string;
    readonly connectorKey: string;
    readonly providerCallId: string;
  }): Promise<VoiceTransportSession | null> {
    const result = await this.#client.query<VoiceSessionRow>(
      `SELECT ${VOICE_COLUMNS}
         FROM platform.communication_voice_sessions
        WHERE tenant_id = $1::uuid
          AND connector_key = $2
          AND provider_call_id = $3
        LIMIT 1`,
      [input.tenantId, input.connectorKey, input.providerCallId],
    );
    return result.rows[0] === undefined ? null : mapSession(result.rows[0]);
  }

  async applyTransition(
    input: ApplyVoiceTransportTransitionInput,
  ): Promise<ApplyVoiceTransportTransitionResult> {
    const currentResult = await this.#client.query<VoiceSessionRow>(
      `SELECT ${VOICE_COLUMNS}
         FROM platform.communication_voice_sessions
        WHERE tenant_id = $1::uuid AND call_id = $2::uuid
        FOR UPDATE`,
      [input.tenantId, input.callId],
    );
    const currentRow = currentResult.rows[0];
    if (currentRow === undefined) throw new Error('VOICE_CALL_NOT_FOUND');
    const current = mapSession(currentRow);

    if (input.transition.providerEventId !== undefined) {
      const duplicate = await this.#client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM platform.communication_voice_events
            WHERE tenant_id = $1::uuid AND provider_event_id = $2
         ) AS exists`,
        [input.tenantId, input.transition.providerEventId],
      );
      if (duplicate.rows[0]?.exists === true) return { applied: false, session: current };
    }

    if (current.state === input.transition.to) return { applied: false, session: current };
    if (input.transition.from !== current.state) {
      throw new Error(`VOICE_CALL_STALE_FROM_STATE:${input.transition.from}->${current.state}`);
    }
    assertVoiceCallTransition(current.state, input.transition.to);

    const terminal = input.transition.to === 'COMPLETED'
      || input.transition.to === 'FAILED'
      || input.transition.to === 'CANCELLED';

    const updatedResult = await this.#client.query<VoiceSessionRow>(
      `UPDATE platform.communication_voice_sessions
          SET state = $3,
              provider_call_id = COALESCE($4, provider_call_id),
              recording_ref = COALESCE($5, recording_ref),
              transcript_ref = COALESCE($6, transcript_ref),
              answered_at = CASE
                WHEN $3 = 'ANSWERED' THEN COALESCE(answered_at, $7)
                ELSE answered_at
              END,
              ended_at = CASE
                WHEN $8::boolean THEN COALESCE(ended_at, $7)
                ELSE ended_at
              END,
              last_reason_code = $9,
              updated_at = $7
        WHERE tenant_id = $1::uuid AND call_id = $2::uuid
        RETURNING ${VOICE_COLUMNS}`,
      [
        input.tenantId,
        input.callId,
        input.transition.to,
        input.transition.providerCallId ?? null,
        input.transition.recordingRef ?? null,
        input.transition.transcriptRef ?? null,
        input.transition.occurredAt,
        terminal,
        input.transition.reasonCode ?? null,
      ],
    );
    const updated = mapRequired(updatedResult.rows[0]);

    await this.#client.query(
      `INSERT INTO platform.communication_voice_events (
         call_id, tenant_id, from_state, to_state, provider_event_id,
         provider_call_id, recording_ref, transcript_ref, reason_code, occurred_at
       ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.callId,
        input.tenantId,
        current.state,
        input.transition.to,
        input.transition.providerEventId ?? null,
        input.transition.providerCallId ?? null,
        input.transition.recordingRef ?? null,
        input.transition.transcriptRef ?? null,
        input.transition.reasonCode ?? null,
        input.transition.occurredAt,
      ],
    );

    return { applied: true, session: updated };
  }
}

function mapRequired(row: VoiceSessionRow | undefined): VoiceTransportSession {
  if (row === undefined) throw new Error('VOICE_CALL_WRITE_FAILED');
  return mapSession(row);
}

function mapSession(row: VoiceSessionRow): VoiceTransportSession {
  return {
    callId: row.call_id,
    tenantId: row.tenant_id,
    ...(row.organization_id === null ? {} : { organizationId: row.organization_id }),
    connectorKey: row.connector_key,
    ...(row.provider_call_id === null ? {} : { providerCallId: row.provider_call_id }),
    direction: row.direction,
    from: {
      address: row.from_address,
      ...(row.from_subject_id === null ? {} : { subjectId: row.from_subject_id }),
    },
    to: {
      address: row.to_address,
      ...(row.to_subject_id === null ? {} : { subjectId: row.to_subject_id }),
    },
    state: row.state,
    requestedAt: toIso(row.requested_at),
    ...(row.answered_at === null ? {} : { answeredAt: toIso(row.answered_at) }),
    ...(row.ended_at === null ? {} : { endedAt: toIso(row.ended_at) }),
    ...(row.recording_ref === null ? {} : { recordingRef: row.recording_ref }),
    ...(row.transcript_ref === null ? {} : { transcriptRef: row.transcript_ref }),
    ...(row.conversation_id === null ? {} : { conversationId: row.conversation_id }),
    ...(row.agent_id === null ? {} : { agentId: row.agent_id }),
    ...(row.human_handoff_requested_at === null
      ? {}
      : { humanHandoffRequestedAt: toIso(row.human_handoff_requested_at) }),
    ...(row.last_reason_code === null ? {} : { lastReasonCode: row.last_reason_code }),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
