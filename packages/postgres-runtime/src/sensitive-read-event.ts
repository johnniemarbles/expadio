import {
  validateSensitiveReadAuditEvent,
  type SensitiveReadAuditEvent,
  type SensitiveReadAuditRepository,
  type SensitiveReadOutcome,
} from '@expadio/audit';
import type { PostgresClient } from './index.ts';

interface SensitiveReadRow {
  readonly event_id: string;
  readonly request_id: string;
  readonly tenant_id: string;
  readonly requested_by_subject_id: string;
  readonly resource_type: string;
  readonly resource_id: string;
  readonly purpose: string;
  readonly legal_basis: string;
  readonly authorization_decision_id: string;
  readonly authorization_reason_key: string;
  readonly outcome: SensitiveReadOutcome;
  readonly result_reference: string | null;
  readonly classifications: readonly string[];
  readonly source_references: readonly string[];
  readonly failure_reason_key: string | null;
  readonly requested_at: Date | string;
  readonly recorded_at: Date | string;
  readonly correlation_id: string;
  readonly evidence_refs: readonly string[];
}

export class PostgresSensitiveReadAuditRepository
implements SensitiveReadAuditRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async record(event: SensitiveReadAuditEvent): Promise<{
    readonly recorded: boolean;
    readonly event: SensitiveReadAuditEvent;
  }> {
    validateSensitiveReadAuditEvent(event);
    const result = await this.#client.query(
      `INSERT INTO platform.sensitive_read_events (
         event_id, request_id, tenant_id, requested_by_subject_id,
         resource_type, resource_id, purpose, legal_basis,
         authorization_decision_id, authorization_reason_key, outcome,
         result_reference, classifications, source_references,
         failure_reason_key, requested_at, recorded_at,
         correlation_id, evidence_refs
       ) VALUES (
         $1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13::text[], $14::text[], $15,
         $16::timestamptz, $17::timestamptz, $18::uuid, $19::text[]
       ) ON CONFLICT DO NOTHING`,
      values(event),
    );
    if (result.rowCount === 1) return { recorded: true, event };

    const existing = await this.findByRequest(
      event.request.tenantId,
      event.request.requestId,
    );
    if (existing === undefined) {
      throw new Error('SENSITIVE_READ_CONFLICT_WITHOUT_VISIBLE_EVENT');
    }
    if (JSON.stringify(existing) !== JSON.stringify(event)) {
      throw new Error('SENSITIVE_READ_IDEMPOTENCY_CONFLICT');
    }
    return { recorded: false, event: existing };
  }

  async findByRequest(
    tenantId: string,
    requestId: string,
  ): Promise<SensitiveReadAuditEvent | undefined> {
    const result = await this.#client.query<SensitiveReadRow>(
      SENSITIVE_READ_SELECT
        + ' WHERE tenant_id = $1::uuid AND request_id = $2 LIMIT 1',
      [tenantId, requestId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : map(row);
  }
}

const SENSITIVE_READ_SELECT =
  `SELECT event_id, request_id, tenant_id, requested_by_subject_id,
          resource_type, resource_id, purpose, legal_basis,
          authorization_decision_id, authorization_reason_key, outcome,
          result_reference, classifications, source_references,
          failure_reason_key, requested_at, recorded_at,
          correlation_id, evidence_refs
     FROM platform.sensitive_read_events`;

function values(event: SensitiveReadAuditEvent): readonly unknown[] {
  const request = event.request;
  return [
    event.eventId, request.requestId, request.tenantId,
    request.requestedBySubjectId, request.resourceReference.type,
    request.resourceReference.id, request.purpose, request.legalBasis,
    event.authorizationDecisionId, event.authorizationReasonKey,
    event.outcome, event.resultReference, [...event.classifications],
    [...event.sourceReferences], event.failureReasonKey,
    request.requestedAt, event.recordedAt, request.correlationId,
    [...request.evidenceRefs],
  ];
}

function map(row: SensitiveReadRow): SensitiveReadAuditEvent {
  return {
    eventId: row.event_id,
    request: {
      requestId: row.request_id,
      tenantId: row.tenant_id,
      requestedBySubjectId: row.requested_by_subject_id,
      resourceReference: {
        type: row.resource_type,
        id: row.resource_id,
      },
      purpose: row.purpose,
      legalBasis: row.legal_basis,
      requestedAt: iso(row.requested_at),
      correlationId: row.correlation_id,
      evidenceRefs: [...row.evidence_refs],
    },
    authorizationDecisionId: row.authorization_decision_id,
    authorizationReasonKey: row.authorization_reason_key,
    outcome: row.outcome,
    resultReference: row.result_reference,
    classifications: [...row.classifications],
    sourceReferences: [...row.source_references],
    failureReasonKey: row.failure_reason_key,
    recordedAt: iso(row.recorded_at),
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
