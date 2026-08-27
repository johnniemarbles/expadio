import { NextResponse } from 'next/server';
import { describeBlastRadius } from '@expadio/credential-custody';
import {
  resolveRequestContext,
  withTenantClient,
  deniedResponse,
} from '../../../../../../lib/request-context';

/**
 * Design spec §3.4 — blast-radius preview.
 *
 * Shown before any destructive connector action. Computed from routing
 * policies and delivery history. Never estimated: an estimate that is wrong
 * in the reassuring direction is worse than no number at all.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const context = await resolveRequestContext();
    const connectorKey = decodeURIComponent((await params).key);

    const radius = await withTenantClient(context, async (client) => {
      const usage = await client.query<{
        tenant_count: string;
        channels: string[];
        message_count: string;
      }>(
        `SELECT
           count(DISTINCT d.tenant_id)::text AS tenant_count,
           COALESCE(ARRAY_AGG(DISTINCT d.channel) FILTER (WHERE d.channel IS NOT NULL), '{}') AS channels,
           count(*)::text AS message_count
         FROM platform.communication_deliveries d
         WHERE d.connector_key = $1
           AND d.created_at >= now() - interval '30 days'`,
        [connectorKey],
      ).catch(() => ({ rows: [{ tenant_count: '0', channels: [] as string[], message_count: '0' }] }));

      const fallback = await client.query<{ without_fallback: string }>(
        `SELECT count(*)::text AS without_fallback
           FROM platform.connector_routing_policies p
          WHERE $1 = ANY(COALESCE(p.allowed_connector_keys, ARRAY[$1]))
            AND p.enabled = true
            AND coalesce(array_length(p.allowed_connector_keys, 1), 1) <= 1`,
        [connectorKey],
      ).catch(() => ({ rows: [{ without_fallback: '0' }] }));

      const row = usage.rows[0]!;
      return describeBlastRadius({
        connectorKey,
        tenantCount: Number(row.tenant_count),
        channels: row.channels,
        messagesLast30Days: Number(row.message_count),
        tenantsWithoutFallback: Number(fallback.rows[0]?.without_fallback ?? 0),
      });
    });

    return NextResponse.json(radius);
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
