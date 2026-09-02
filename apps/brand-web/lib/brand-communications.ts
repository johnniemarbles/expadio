import type pg from 'pg';

export interface BrandCommunicationChannelSummary {
  readonly channel: string;
  readonly total: number;
  readonly delivered: number;
  readonly failed: number;
  readonly deliveryRatePct: number | null;
}

export interface BrandCommunicationOverview {
  readonly capturedAt: string;
  readonly organizationId: string;
  readonly totals: {
    readonly deliveries: number;
    readonly delivered: number;
    readonly failed: number;
    readonly inFlight: number;
  };
  readonly readiness: {
    readonly activeTemplates: number;
    readonly draftTemplates: number;
    readonly verifiedSenders: number;
    readonly pendingSenders: number;
    readonly activeSuppressions: number;
  };
  readonly channels: readonly BrandCommunicationChannelSummary[];
  readonly recentDeliveries: readonly {
    readonly deliveryId: string;
    readonly channel: string;
    readonly state: string;
    readonly attemptCount: number;
    readonly reasonCode: string | null;
    readonly requestedAt: string;
    readonly updatedAt: string;
  }[];
}

interface CountRow { count: number; }
interface StatusCountRow { status: string; count: number; }
interface VerificationCountRow { verification_status: string; count: number; }
interface ChannelRow { channel: string; total: number; delivered: number; failed: number; }
interface DeliveryRow {
  delivery_id: string;
  channel: string;
  state: string;
  attempt_count: number;
  last_reason_code: string | null;
  requested_at: Date | string;
  updated_at: Date | string;
}

/**
 * Brand-facing Communications projection.
 *
 * This deliberately exposes business-operational state only. Provider registry,
 * connector routing, credential references, custody, provider attempts and raw
 * provider webhook payloads remain Platform-owned and are not selected here.
 */
export async function loadBrandCommunicationOverview(
  client: pg.PoolClient,
  input: { tenantId: string; organizationId: string },
): Promise<BrandCommunicationOverview> {
  const [channelsResult, templateResult, senderResult, suppressionResult, recentResult] = await Promise.all([
    client.query<ChannelRow>(
      `SELECT channel,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE state = 'DELIVERED')::int AS delivered,
              COUNT(*) FILTER (WHERE state IN ('FAILED','BOUNCED','COMPLAINED','CANCELLED'))::int AS failed
         FROM platform.communication_deliveries
        WHERE tenant_id = $1::uuid
          AND organization_id = $2::uuid
        GROUP BY channel
        ORDER BY channel`,
      [input.tenantId, input.organizationId],
    ),
    client.query<StatusCountRow>(
      `SELECT status, COUNT(*)::int AS count
         FROM platform.communication_templates
        WHERE (scope = 'PLATFORM'
               OR (tenant_id = $1::uuid AND (organization_id IS NULL OR organization_id = $2::uuid)))
          AND status IN ('ACTIVE','DRAFT')
        GROUP BY status`,
      [input.tenantId, input.organizationId],
    ),
    client.query<VerificationCountRow>(
      `SELECT verification_status, COUNT(*)::int AS count
         FROM platform.communication_sender_identities
        WHERE status = 'ACTIVE'
          AND verification_status IN ('VERIFIED','PENDING')
          AND (
            scope = 'PLATFORM'
            OR (scope = 'TENANT' AND tenant_id = $1::uuid)
            OR (scope = 'ORGANIZATION' AND tenant_id = $1::uuid AND organization_id = $2::uuid)
          )
        GROUP BY verification_status`,
      [input.tenantId, input.organizationId],
    ),
    client.query<CountRow>(
      `SELECT COUNT(*)::int AS count
         FROM platform.communication_suppressions
        WHERE tenant_id = $1::uuid
          AND (organization_id IS NULL OR organization_id = $2::uuid)
          AND status = 'ACTIVE'
          AND recorded_at <= now()
          AND (valid_until IS NULL OR valid_until > now())`,
      [input.tenantId, input.organizationId],
    ),
    client.query<DeliveryRow>(
      `SELECT delivery_id, channel, state, attempt_count, last_reason_code, requested_at, updated_at
         FROM platform.communication_deliveries
        WHERE tenant_id = $1::uuid
          AND organization_id = $2::uuid
        ORDER BY requested_at DESC
        LIMIT 12`,
      [input.tenantId, input.organizationId],
    ),
  ]);

  const channels = channelsResult.rows.map((row) => ({
    channel: row.channel,
    total: row.total,
    delivered: row.delivered,
    failed: row.failed,
    deliveryRatePct: row.total === 0 ? null : Math.round((row.delivered / row.total) * 1000) / 10,
  }));
  const deliveries = channels.reduce((sum, item) => sum + item.total, 0);
  const delivered = channels.reduce((sum, item) => sum + item.delivered, 0);
  const failed = channels.reduce((sum, item) => sum + item.failed, 0);
  const templateCounts = new Map(templateResult.rows.map((row) => [row.status, row.count]));
  const senderCounts = new Map(senderResult.rows.map((row) => [row.verification_status, row.count]));

  return {
    capturedAt: new Date().toISOString(),
    organizationId: input.organizationId,
    totals: {
      deliveries,
      delivered,
      failed,
      inFlight: Math.max(0, deliveries - delivered - failed),
    },
    readiness: {
      activeTemplates: templateCounts.get('ACTIVE') ?? 0,
      draftTemplates: templateCounts.get('DRAFT') ?? 0,
      verifiedSenders: senderCounts.get('VERIFIED') ?? 0,
      pendingSenders: senderCounts.get('PENDING') ?? 0,
      activeSuppressions: suppressionResult.rows[0]?.count ?? 0,
    },
    channels,
    recentDeliveries: recentResult.rows.map((row) => ({
      deliveryId: row.delivery_id,
      channel: row.channel,
      state: row.state,
      attemptCount: row.attempt_count,
      reasonCode: row.last_reason_code,
      requestedAt: new Date(row.requested_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    })),
  };
}
