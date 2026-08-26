import {
  validateCredentialRotationEvent,
  validateCredentialRotationHistory,
  type AppendCredentialRotationEventResult,
  type CredentialRotationEvent,
  type CredentialRotationEventType,
  type CredentialRotationRepository,
} from '@expadio/provider-registry';
import type { PostgresClient } from './index.ts';

interface RotationRow {
  readonly event_id: string;
  readonly rotation_reference: string;
  readonly sequence: number;
  readonly request_id: string;
  readonly tenant_id: string;
  readonly requested_by_subject_id: string;
  readonly connector_key: string;
  readonly current_credential_reference: CredentialRotationEvent['currentCredentialReference'];
  readonly replacement_credential_reference: CredentialRotationEvent['replacementCredentialReference'];
  readonly event_type: CredentialRotationEventType;
  readonly authorization_decision_id: string;
  readonly reason: string;
  readonly occurred_at: Date | string;
  readonly correlation_id: string;
  readonly evidence_refs: readonly string[];
}

export class PostgresCredentialRotationRepository
implements CredentialRotationRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async append(
    event: CredentialRotationEvent,
  ): Promise<AppendCredentialRotationEventResult> {
    validateCredentialRotationEvent(event);
    const existing = await this.#findEvent(event.tenantId, event.eventId);
    if (existing !== undefined) {
      if (!same(existing, event)) {
        throw new Error('CREDENTIAL_ROTATION_EVENT_ID_CONFLICT');
      }
      return { appended: false, event: existing };
    }

    const expected = await this.#expectedSequence(
      event.tenantId,
      event.rotationReference,
    );
    if (event.sequence !== expected) {
      throw new Error(
        'CREDENTIAL_ROTATION_EVENT_SEQUENCE_CONFLICT:expected=' + expected,
      );
    }

    try {
      const result = await this.#client.query(
        `INSERT INTO platform.credential_rotation_events (
           event_id, rotation_reference, sequence, request_id, tenant_id,
           requested_by_subject_id, connector_key,
           current_credential_reference, replacement_credential_reference,
           event_type, authorization_decision_id, reason, occurred_at,
           correlation_id, evidence_refs
         ) VALUES (
           $1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10,
           $11, $12, $13::timestamptz, $14::uuid, $15::text[]
         )`,
        values(event),
      );
      if (result.rowCount === 1) return { appended: true, event };
    } catch (error) {
      if (postgresErrorCode(error) !== '23505') throw error;
      const concurrent = await this.#findEvent(event.tenantId, event.eventId);
      if (concurrent !== undefined && same(concurrent, event)) {
        return { appended: false, event: concurrent };
      }
      const next = await this.#expectedSequence(
        event.tenantId,
        event.rotationReference,
      );
      throw new Error(
        'CREDENTIAL_ROTATION_EVENT_SEQUENCE_CONFLICT:expected=' + next,
      );
    }
    throw new Error('CREDENTIAL_ROTATION_EVENT_INSERT_DID_NOT_COMMIT');
  }

  async load(
    tenantId: string,
    rotationReference: string,
  ): Promise<readonly CredentialRotationEvent[]> {
    const result = await this.#client.query<RotationRow>(
      ROTATION_SELECT
        + ' WHERE tenant_id = $1::uuid AND rotation_reference = $2'
        + ' ORDER BY sequence ASC',
      [tenantId, rotationReference],
    );
    return validateCredentialRotationHistory(result.rows.map(map));
  }

  async #findEvent(
    tenantId: string,
    eventId: string,
  ): Promise<CredentialRotationEvent | undefined> {
    const result = await this.#client.query<RotationRow>(
      ROTATION_SELECT
        + ' WHERE tenant_id = $1::uuid AND event_id = $2::uuid LIMIT 1',
      [tenantId, eventId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : map(row);
  }

  async #expectedSequence(
    tenantId: string,
    rotationReference: string,
  ): Promise<number> {
    const result = await this.#client.query<{ readonly expected_sequence: number }>(
      `SELECT COALESCE(max(sequence), 0)::integer + 1 AS expected_sequence
         FROM platform.credential_rotation_events
        WHERE tenant_id = $1::uuid AND rotation_reference = $2`,
      [tenantId, rotationReference],
    );
    return result.rows[0]?.expected_sequence ?? 1;
  }
}

const ROTATION_SELECT =
  `SELECT event_id, rotation_reference, sequence, request_id, tenant_id,
          requested_by_subject_id, connector_key,
          current_credential_reference, replacement_credential_reference,
          event_type, authorization_decision_id, reason, occurred_at,
          correlation_id, evidence_refs
     FROM platform.credential_rotation_events`;

function values(event: CredentialRotationEvent): readonly unknown[] {
  return [
    event.eventId, event.rotationReference, event.sequence, event.requestId,
    event.tenantId, event.requestedBySubjectId, event.connectorKey,
    event.currentCredentialReference, event.replacementCredentialReference,
    event.eventType, event.authorizationDecisionId, event.reason,
    event.occurredAt, event.correlationId, [...event.evidenceRefs],
  ];
}

function map(row: RotationRow): CredentialRotationEvent {
  return {
    eventId: row.event_id,
    rotationReference: row.rotation_reference,
    sequence: row.sequence,
    requestId: row.request_id,
    tenantId: row.tenant_id,
    requestedBySubjectId: row.requested_by_subject_id,
    connectorKey: row.connector_key,
    currentCredentialReference: row.current_credential_reference,
    replacementCredentialReference: row.replacement_credential_reference,
    eventType: row.event_type,
    authorizationDecisionId: row.authorization_decision_id,
    reason: row.reason,
    occurredAt: iso(row.occurred_at),
    correlationId: row.correlation_id,
    evidenceRefs: [...row.evidence_refs],
  };
}

function postgresErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
