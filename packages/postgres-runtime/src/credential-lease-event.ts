import type {
  CredentialLeaseAuditEvent,
  CredentialLeaseAuditRepository,
  CredentialLeaseOutcome,
  RecordCredentialLeaseAuditEventResult,
} from '@expadio/provider-registry';
import type { PostgresClient } from './index.ts';

interface CredentialLeaseEventRow {
  readonly event_id: string;
  readonly request_id: string;
  readonly tenant_id: string;
  readonly requested_by_subject_id: string;
  readonly connector_key: string;
  readonly credential_reference: CredentialLeaseAuditEvent['credentialReference'];
  readonly purpose: string;
  readonly authorization_decision_id: string;
  readonly authorization_reason_key: string;
  readonly outcome: CredentialLeaseOutcome;
  readonly lease_reference: string | null;
  readonly issuer_audit_reference: string | null;
  readonly failure_reason_key: string | null;
  readonly requested_at: Date | string;
  readonly issued_at: Date | string | null;
  readonly expires_at: Date | string | null;
  readonly recorded_at: Date | string;
  readonly correlation_id: string;
  readonly evidence_refs: readonly string[];
}

export class PostgresCredentialLeaseAuditRepository
implements CredentialLeaseAuditRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async record(
    event: CredentialLeaseAuditEvent,
  ): Promise<RecordCredentialLeaseAuditEventResult> {
    validate(event);
    const result = await this.#client.query(
      `INSERT INTO platform.credential_lease_events (
         event_id, request_id, tenant_id, requested_by_subject_id,
         connector_key, credential_reference, purpose,
         authorization_decision_id, authorization_reason_key, outcome,
         lease_reference, issuer_audit_reference, failure_reason_key,
         requested_at, issued_at, expires_at, recorded_at,
         correlation_id, evidence_refs
       ) VALUES (
         $1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14::timestamptz, $15::timestamptz,
         $16::timestamptz, $17::timestamptz, $18::uuid, $19::text[]
       ) ON CONFLICT DO NOTHING`,
      values(event),
    );
    if (result.rowCount === 1) return { recorded: true, event };

    const existing = await this.findByRequest({
      tenantId: event.request.tenantId,
      requestId: event.request.requestId,
    });
    if (existing === undefined) {
      throw new Error('CREDENTIAL_LEASE_CONFLICT_WITHOUT_VISIBLE_EVENT');
    }
    if (JSON.stringify(existing) !== JSON.stringify(event)) {
      throw new Error('CREDENTIAL_LEASE_IDEMPOTENCY_CONFLICT');
    }
    return { recorded: false, event: existing };
  }

  async findByRequest(input: {
    readonly tenantId: string;
    readonly requestId: string;
  }): Promise<CredentialLeaseAuditEvent | undefined> {
    const result = await this.#client.query<CredentialLeaseEventRow>(
      LEASE_SELECT + ' WHERE tenant_id = $1::uuid AND request_id = $2 LIMIT 1',
      [input.tenantId, input.requestId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : map(row);
  }
}

const LEASE_SELECT =
  `SELECT event_id, request_id, tenant_id, requested_by_subject_id,
          connector_key, credential_reference, purpose,
          authorization_decision_id, authorization_reason_key, outcome,
          lease_reference, issuer_audit_reference, failure_reason_key,
          requested_at, issued_at, expires_at, recorded_at,
          correlation_id, evidence_refs
     FROM platform.credential_lease_events`;

function values(event: CredentialLeaseAuditEvent): readonly unknown[] {
  const request = event.request;
  return [
    event.eventId, request.requestId, request.tenantId,
    request.requestedBySubjectId, request.connectorKey,
    event.credentialReference, request.purpose,
    event.authorizationDecisionId, event.authorizationReasonKey,
    event.outcome, event.leaseReference, event.issuerAuditReference,
    event.failureReasonKey, request.requestedAt, event.issuedAt,
    event.expiresAt, event.recordedAt, request.correlationId,
    [...request.evidenceRefs],
  ];
}

function map(row: CredentialLeaseEventRow): CredentialLeaseAuditEvent {
  return {
    eventId: row.event_id,
    request: {
      requestId: row.request_id,
      tenantId: row.tenant_id,
      requestedBySubjectId: row.requested_by_subject_id,
      connectorKey: row.connector_key,
      purpose: row.purpose,
      requestedAt: iso(row.requested_at),
      correlationId: row.correlation_id,
      evidenceRefs: [...row.evidence_refs],
    },
    credentialReference: row.credential_reference,
    authorizationDecisionId: row.authorization_decision_id,
    authorizationReasonKey: row.authorization_reason_key,
    outcome: row.outcome,
    leaseReference: row.lease_reference,
    issuerAuditReference: row.issuer_audit_reference,
    failureReasonKey: row.failure_reason_key,
    issuedAt: nullableIso(row.issued_at),
    expiresAt: nullableIso(row.expires_at),
    recordedAt: iso(row.recorded_at),
  };
}

function validate(event: CredentialLeaseAuditEvent): void {
  const request = event.request;
  const strings = [
    event.eventId, request.requestId, request.tenantId,
    request.requestedBySubjectId, request.connectorKey, request.purpose,
    request.correlationId, event.credentialReference,
    event.authorizationDecisionId, event.authorizationReasonKey,
    event.recordedAt, request.requestedAt, ...request.evidenceRefs,
  ];
  if (strings.some((value) => value.trim() === '' || value !== value.trim())) {
    throw new Error('CREDENTIAL_LEASE_EVENT_INVALID');
  }

  const requested = Date.parse(request.requestedAt);
  const recorded = Date.parse(event.recordedAt);
  if (!Number.isFinite(requested) || !Number.isFinite(recorded) || recorded < requested) {
    throw new Error('CREDENTIAL_LEASE_EVENT_INVALID');
  }

  if (event.outcome === 'ISSUED') {
    const issued = Date.parse(event.issuedAt ?? '');
    const expires = Date.parse(event.expiresAt ?? '');
    if (event.leaseReference === null || event.issuerAuditReference === null ||
      event.failureReasonKey !== null || !Number.isFinite(issued) ||
      expires <= issued || expires - issued > 900_000) {
      throw new Error('CREDENTIAL_LEASE_EVENT_INVALID');
    }
  } else if (event.leaseReference !== null ||
    event.issuerAuditReference !== null || event.issuedAt !== null ||
    event.expiresAt !== null || event.failureReasonKey?.trim() === '') {
    throw new Error('CREDENTIAL_LEASE_EVENT_INVALID');
  }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}
