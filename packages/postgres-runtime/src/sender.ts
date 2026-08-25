import type { CommunicationPurpose } from '@expadio/communication';
import type {
  CommunicationSenderChannel,
  CommunicationSenderIdentity,
  CommunicationSenderRepository,
  CommunicationSenderResolution,
  CommunicationSenderResolutionInput,
  CommunicationSenderStatus,
  CommunicationSenderVerificationStatus,
} from '@expadio/communication/sender';
import type { PostgresClient } from './index.ts';

interface SenderRow {
  readonly sender_id: string;
  readonly scope: 'PLATFORM' | 'TENANT' | 'ORGANIZATION';
  readonly tenant_id: string | null;
  readonly organization_id: string | null;
  readonly channel: CommunicationSenderChannel;
  readonly address: string;
  readonly display_name: string | null;
  readonly reply_to: string | null;
  readonly purposes: readonly CommunicationPurpose[];
  readonly is_default: boolean;
  readonly is_system_fallback: boolean;
  readonly verification_status: CommunicationSenderVerificationStatus;
  readonly status: CommunicationSenderStatus;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

/**
 * Read-only SQL adapter for runtime sender resolution. The supplied client must
 * already be inside a request transaction with verified tenant context.
 */
export class PostgresCommunicationSenderRepository
  implements CommunicationSenderRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async resolveVerifiedDefault(
    input: CommunicationSenderResolutionInput,
  ): Promise<CommunicationSenderResolution> {
    const result = await this.#client.query<SenderRow>(
      `SELECT sender_id, scope, tenant_id, organization_id, channel, address,
              display_name, reply_to, purposes, is_default, is_system_fallback,
              verification_status, status, created_at, updated_at
         FROM platform.communication_sender_identities
        WHERE status = 'ACTIVE'
          AND verification_status = 'VERIFIED'
          AND is_default = true
          AND channel = $3
          AND $4 = ANY(purposes)
          AND (
            (scope = 'TENANT' AND tenant_id = $1::uuid)
            OR (
              $2::uuid IS NOT NULL
              AND scope = 'ORGANIZATION'
              AND tenant_id = $1::uuid
              AND organization_id = $2::uuid
            )
            OR (
              $5::boolean = true
              AND scope = 'PLATFORM'
              AND is_system_fallback = true
            )
          )
        ORDER BY CASE scope
                   WHEN 'ORGANIZATION' THEN 1
                   WHEN 'TENANT' THEN 2
                   WHEN 'PLATFORM' THEN 3
                   ELSE 4
                 END
        LIMIT 1`,
      [
        input.tenantId,
        input.organizationId ?? null,
        input.channel,
        input.purpose,
        input.platformFallback === 'ALLOW',
      ],
    );

    const row = result.rows[0];
    if (row === undefined) return { matchedScope: 'NONE', sender: null };
    return { matchedScope: row.scope, sender: mapSender(row) };
  }
}

function mapSender(row: SenderRow): CommunicationSenderIdentity {
  const scope = row.scope === 'PLATFORM'
    ? { kind: 'PLATFORM' as const }
    : row.scope === 'TENANT'
      ? { kind: 'TENANT' as const, tenantId: required(row.tenant_id, 'tenant_id') }
      : {
          kind: 'ORGANIZATION' as const,
          tenantId: required(row.tenant_id, 'tenant_id'),
          organizationId: required(row.organization_id, 'organization_id'),
        };

  return {
    senderId: row.sender_id,
    scope,
    channel: row.channel,
    address: row.address,
    ...(row.display_name === null ? {} : { displayName: row.display_name }),
    ...(row.reply_to === null ? {} : { replyTo: row.reply_to }),
    purposes: [...row.purposes],
    isDefault: row.is_default,
    isSystemFallback: row.is_system_fallback,
    verificationStatus: row.verification_status,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function required(value: string | null, field: string): string {
  if (value === null) throw new Error(`COMMUNICATION_SENDER_INVALID_${field.toUpperCase()}`);
  return value;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
