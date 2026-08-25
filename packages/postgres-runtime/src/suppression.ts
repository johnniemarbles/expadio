import type {
  AddSuppressionInput,
  CommunicationChannel,
  CommunicationSuppressionReason,
  CommunicationSuppressionRepository,
  FindActiveSuppressionInput,
  PersistedCommunicationSuppression,
  RevokeSuppressionInput,
} from '@expadio/communication';
import type { PostgresClient } from './index.ts';

interface SuppressionRow {
  readonly suppression_id: string;
  readonly tenant_id: string;
  readonly organization_id: string | null;
  readonly recipient_key: string;
  readonly channel: CommunicationChannel;
  readonly reason: CommunicationSuppressionReason;
  readonly source_message_id: string | null;
  readonly recorded_at: Date | string;
  readonly valid_until: Date | string | null;
}

/**
 * Tenant-facing SQL adapter for communication suppressions. The supplied client
 * must already be inside a request transaction with verified tenant context
 * bound to PostgreSQL. Platform-global suppression is intentionally excluded.
 */
export class PostgresCommunicationSuppressionRepository
  implements CommunicationSuppressionRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async findActive(
    input: FindActiveSuppressionInput,
  ): Promise<PersistedCommunicationSuppression | null> {
    const result = await this.#client.query<SuppressionRow>(
      `SELECT suppression_id, tenant_id, organization_id, recipient_key,
              channel, reason, source_message_id, recorded_at, valid_until
         FROM platform.communication_suppressions
        WHERE tenant_id = $1::uuid
          AND channel = $4
          AND lower(recipient_key) = lower($3)
          AND status = 'ACTIVE'
          AND recorded_at <= COALESCE($5::timestamptz, now())
          AND (valid_until IS NULL OR valid_until > COALESCE($5::timestamptz, now()))
          AND (
            ($2::uuid IS NULL AND organization_id IS NULL)
            OR
            ($2::uuid IS NOT NULL AND (organization_id = $2::uuid OR organization_id IS NULL))
          )
        ORDER BY (organization_id IS NOT NULL) DESC, recorded_at DESC
        LIMIT 1`,
      [
        input.tenantId,
        input.organizationId ?? null,
        input.recipientKey,
        input.channel,
        input.at ?? null,
      ],
    );

    const row = result.rows[0];
    return row === undefined ? null : mapSuppression(row);
  }

  async add(input: AddSuppressionInput): Promise<PersistedCommunicationSuppression> {
    const result = await this.#client.query<SuppressionRow>(
      `INSERT INTO platform.communication_suppressions (
         tenant_id, organization_id, recipient_key, channel, reason,
         source_message_id, recorded_at, valid_until
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4, $5, $6,
         COALESCE($7::timestamptz, now()), $8::timestamptz
       )
       RETURNING suppression_id, tenant_id, organization_id, recipient_key,
                 channel, reason, source_message_id, recorded_at, valid_until`,
      [
        input.tenantId,
        input.organizationId ?? null,
        input.recipientKey,
        input.channel,
        input.reason,
        input.sourceMessageId ?? null,
        input.recordedAt ?? null,
        input.validUntil ?? null,
      ],
    );

    const row = result.rows[0];
    if (row === undefined) throw new Error('COMMUNICATION_SUPPRESSION_CREATE_FAILED');
    return mapSuppression(row);
  }

  async revoke(input: RevokeSuppressionInput): Promise<boolean> {
    const result = await this.#client.query(
      `UPDATE platform.communication_suppressions
          SET status = 'REVOKED',
              revoked_at = COALESCE($3::timestamptz, now()),
              updated_at = now()
        WHERE tenant_id = $1::uuid
          AND suppression_id = $2::uuid
          AND status = 'ACTIVE'`,
      [input.tenantId, input.suppressionId, input.revokedAt ?? null],
    );
    return result.rowCount === 1;
  }
}

function mapSuppression(row: SuppressionRow): PersistedCommunicationSuppression {
  return {
    suppressionId: row.suppression_id,
    tenantId: row.tenant_id,
    ...(row.organization_id !== null ? { organizationId: row.organization_id } : {}),
    recipientKey: row.recipient_key,
    channel: row.channel,
    reason: row.reason,
    ...(row.source_message_id !== null ? { sourceMessageId: row.source_message_id } : {}),
    recordedAt: toIsoString(row.recorded_at),
    ...(row.valid_until !== null ? { validUntil: toIsoString(row.valid_until) } : {}),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
