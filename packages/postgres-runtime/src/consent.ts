import type {
  CommunicationChannel,
  CommunicationConsentEventType,
  CommunicationConsentRepository,
  CommunicationConsentSource,
  CommunicationPurpose,
  EffectiveCommunicationConsent,
  PersistedCommunicationConsentEvent,
  RecordCommunicationConsentEventInput,
  ResolveEffectiveCommunicationConsentInput,
} from '@expadio/communication';
import type { PostgresClient } from './index.ts';

interface ConsentEventRow {
  readonly consent_event_id: string;
  readonly tenant_id: string;
  readonly organization_id: string | null;
  readonly subject_id: string | null;
  readonly recipient_key: string;
  readonly channel: CommunicationChannel;
  readonly purpose: CommunicationPurpose;
  readonly event_type: CommunicationConsentEventType;
  readonly source: CommunicationConsentSource;
  readonly policy_version: string | null;
  readonly evidence_ref: string | null;
  readonly effective_at: Date | string;
  readonly expires_at: Date | string | null;
  readonly recorded_at: Date | string;
}

/**
 * SQL adapter for the append-only communication consent ledger. The supplied
 * client must already be inside a request transaction with verified tenant
 * context bound to PostgreSQL.
 */
export class PostgresCommunicationConsentRepository
  implements CommunicationConsentRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async record(
    input: RecordCommunicationConsentEventInput,
  ): Promise<PersistedCommunicationConsentEvent> {
    const result = await this.#client.query<ConsentEventRow>(
      `INSERT INTO platform.communication_consent_events (
         tenant_id, organization_id, subject_id, recipient_key, channel,
         purpose, event_type, source, policy_version, evidence_ref,
         effective_at, expires_at
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4, $5,
         $6, $7, $8, $9, $10,
         COALESCE($11::timestamptz, now()), $12::timestamptz
       )
       RETURNING consent_event_id, tenant_id, organization_id, subject_id,
                 recipient_key, channel, purpose, event_type, source,
                 policy_version, evidence_ref, effective_at, expires_at,
                 recorded_at`,
      [
        input.tenantId,
        input.organizationId ?? null,
        input.subjectId ?? null,
        input.recipientKey,
        input.channel,
        input.purpose,
        input.eventType,
        input.source,
        input.policyVersion ?? null,
        input.evidenceRef ?? null,
        input.effectiveAt ?? null,
        input.expiresAt ?? null,
      ],
    );

    const row = result.rows[0];
    if (row === undefined) throw new Error('COMMUNICATION_CONSENT_EVENT_CREATE_FAILED');
    return mapConsentEvent(row);
  }

  async resolveEffective(
    input: ResolveEffectiveCommunicationConsentInput,
  ): Promise<EffectiveCommunicationConsent> {
    const result = await this.#client.query<ConsentEventRow>(
      `SELECT consent_event_id, tenant_id, organization_id, subject_id,
              recipient_key, channel, purpose, event_type, source,
              policy_version, evidence_ref, effective_at, expires_at,
              recorded_at
         FROM platform.communication_consent_events
        WHERE tenant_id = $1::uuid
          AND channel = $4
          AND purpose = $5
          AND lower(recipient_key) = lower($3)
          AND effective_at <= COALESCE($6::timestamptz, now())
          AND (expires_at IS NULL OR expires_at > COALESCE($6::timestamptz, now()))
          AND (
            ($2::uuid IS NULL AND organization_id IS NULL)
            OR
            ($2::uuid IS NOT NULL AND (organization_id = $2::uuid OR organization_id IS NULL))
          )
        ORDER BY (organization_id IS NOT NULL) DESC,
                 effective_at DESC,
                 recorded_at DESC
        LIMIT 1`,
      [
        input.tenantId,
        input.organizationId ?? null,
        input.recipientKey,
        input.channel,
        input.purpose,
        input.at ?? null,
      ],
    );

    const row = result.rows[0];
    if (row === undefined) {
      return { granted: false, scope: 'NONE', event: null };
    }

    const event = mapConsentEvent(row);
    return {
      granted: event.eventType === 'GRANTED',
      scope: row.organization_id === null ? 'TENANT' : 'ORGANIZATION',
      event,
    };
  }
}

function mapConsentEvent(row: ConsentEventRow): PersistedCommunicationConsentEvent {
  return {
    consentEventId: row.consent_event_id,
    tenantId: row.tenant_id,
    ...(row.organization_id !== null ? { organizationId: row.organization_id } : {}),
    ...(row.subject_id !== null ? { subjectId: row.subject_id } : {}),
    recipientKey: row.recipient_key,
    channel: row.channel,
    purpose: row.purpose,
    eventType: row.event_type,
    source: row.source,
    ...(row.policy_version !== null ? { policyVersion: row.policy_version } : {}),
    ...(row.evidence_ref !== null ? { evidenceRef: row.evidence_ref } : {}),
    effectiveAt: toIsoString(row.effective_at),
    ...(row.expires_at !== null ? { expiresAt: toIsoString(row.expires_at) } : {}),
    recordedAt: toIsoString(row.recorded_at),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
