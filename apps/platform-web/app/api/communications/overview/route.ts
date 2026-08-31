import { resolveRequestContext, withTenantClient, deniedResponse } from "../../../../lib/request-context";
import { NextResponse } from "next/server";
import {
  COMMUNICATION_CHANNELS,
  type CommunicationChannel,
  type CommunicationDeliveryState,
  type CommunicationOverview,
} from "../../../../lib/communication-contracts";
import {
  PLATFORM_PRODUCT_CACHE,
  assertPlatformProductSendingHealth,
  platformProductDenied,
  writePlatformProductLog,
} from "../../../../lib/platform-product-surface";

interface ChannelRow {
  channel: CommunicationChannel;
  total: number;
  delivered: number;
  failed: number;
}

interface CountRow {
  count: number;
}

interface DeliveryRow {
  delivery_id: string;
  channel: CommunicationChannel;
  state: CommunicationDeliveryState;
  connector_key: string;
  attempt_count: number;
  last_reason_code: string | null;
  requested_at: Date | string;
  updated_at: Date | string;
}

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    return await withTenantClient(context, async (client) => {
      const [channelResult, templateResult, senderResult, suppressionResult, deliveryResult] =
        await Promise.all([
          client.query<ChannelRow>(
          `SELECT channel,
                  COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE state = 'DELIVERED')::int AS delivered,
                  COUNT(*) FILTER (WHERE state IN ('FAILED','BOUNCED','COMPLAINED','CANCELLED'))::int AS failed
             FROM platform.communication_deliveries
            WHERE tenant_id = $1
            GROUP BY channel`,
          [context.tenantId],
        ),
        client.query<{ status: "ACTIVE" | "DRAFT"; count: number }>(
          `SELECT status, COUNT(*)::int AS count
             FROM platform.communication_templates
            WHERE (scope = 'PLATFORM' OR tenant_id = $1)
              AND status IN ('ACTIVE','DRAFT')
            GROUP BY status`,
          [context.tenantId],
        ),
        client.query<{ verification_status: "VERIFIED" | "PENDING"; count: number }>(
          `SELECT verification_status, COUNT(*)::int AS count
             FROM platform.communication_sender_identities
            WHERE (scope = 'PLATFORM' OR tenant_id = $1)
              AND status = 'ACTIVE'
              AND verification_status IN ('VERIFIED','PENDING')
            GROUP BY verification_status`,
          [context.tenantId],
        ),
        client.query<CountRow>(
          `SELECT COUNT(*)::int AS count
             FROM platform.communication_suppressions
            WHERE tenant_id = $1
              AND status = 'ACTIVE'
              AND (valid_until IS NULL OR valid_until > now())`,
          [context.tenantId],
        ),
        client.query<DeliveryRow>(
          `SELECT delivery_id, channel, state, connector_key, attempt_count,
                  last_reason_code, requested_at, updated_at
             FROM platform.communication_deliveries
            WHERE tenant_id = $1
            ORDER BY requested_at DESC
            LIMIT 12`,
          [context.tenantId],
        ),
      ]);

    const channelRows = new Map(channelResult.rows.map((row) => [row.channel, row]));
    const channels = COMMUNICATION_CHANNELS.map((channel) => {
      const row = channelRows.get(channel);
      const total = row?.total ?? 0;
      const delivered = row?.delivered ?? 0;
      return {
        channel,
        total,
        delivered,
        failed: row?.failed ?? 0,
        deliveryRate: total === 0 ? null : Math.round((delivered / total) * 1000) / 10,
      };
    });

    const deliveries = channels.reduce((sum, channel) => sum + channel.total, 0);
    const delivered = channels.reduce((sum, channel) => sum + channel.delivered, 0);
    const failed = channels.reduce((sum, channel) => sum + channel.failed, 0);
    const templateCounts = new Map(templateResult.rows.map((row) => [row.status, row.count]));
    const senderCounts = new Map(
      senderResult.rows.map((row) => [row.verification_status, row.count]),
    );

    const overview: CommunicationOverview = {
      source: "live",
      capturedAt: new Date().toISOString(),
      totals: {
        deliveries,
        delivered,
        inFlight: Math.max(0, deliveries - delivered - failed),
        failed,
      },
      readiness: {
        activeTemplates: templateCounts.get("ACTIVE") ?? 0,
        draftTemplates: templateCounts.get("DRAFT") ?? 0,
        verifiedSenders: senderCounts.get("VERIFIED") ?? 0,
        pendingSenders: senderCounts.get("PENDING") ?? 0,
        activeSuppressions: suppressionResult.rows[0]?.count ?? 0,
      },
      channels,
      recentDeliveries: deliveryResult.rows.map((row) => ({
        id: row.delivery_id,
        channel: row.channel,
        state: row.state,
        connectorKey: row.connector_key,
        attemptCount: row.attempt_count,
        reasonCode: row.last_reason_code,
        requestedAt: new Date(row.requested_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      })),
    };

      assertPlatformProductSendingHealth(overview);
      return NextResponse.json(overview, { headers: PLATFORM_PRODUCT_CACHE });
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'PLATFORM_PII_BOUNDARY') {
      return NextResponse.json(platformProductDenied('PLATFORM_PII_BOUNDARY'), {
        status: 500,
        headers: PLATFORM_PRODUCT_CACHE,
      });
    }
    if (error && typeof error === 'object' && 'denied' in error) {
      const { body, status } = deniedResponse(error as { denied: true });
      return NextResponse.json(body, { status, headers: PLATFORM_PRODUCT_CACHE });
    }
    writePlatformProductLog((line) => console.error(line), 'Communications overview INTERNAL_ERROR');
    return NextResponse.json(platformProductDenied(), { status: 500, headers: PLATFORM_PRODUCT_CACHE });
  }
}
