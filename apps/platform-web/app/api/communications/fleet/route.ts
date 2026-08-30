import { NextResponse } from "next/server";
import { resolveRequestContext, withTenantClient, deniedResponse } from "../../../../lib/request-context";
import type { DeniedResult } from '@expadio/ui/contracts';

export interface FleetHealthItem {
  connectorKey: string;
  channel: string;
  total: number;
  delivered: number;
  failed: number;
  inFlight: number;
  deliveryRatePct: number | null;
  lastEventAt: string | null;
}

export async function GET(request: Request) {
  

  try {
    const effectiveContext = await resolveRequestContext(request);
    return await withTenantClient(effectiveContext, async (client) => {

    const result = await client.query(
      `SELECT
         connector_key,
         channel,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE state = 'DELIVERED')::int AS delivered,
         COUNT(*) FILTER (WHERE state IN ('FAILED', 'BOUNCED', 'COMPLAINED'))::int AS failed,
         COUNT(*) FILTER (WHERE state IN ('PENDING', 'ACCEPTED', 'SENT'))::int AS in_flight,
         ROUND(
           COUNT(*) FILTER (WHERE state = 'DELIVERED') * 100.0
           / NULLIF(COUNT(*) FILTER (WHERE state NOT IN ('PENDING', 'CANCELLED')), 0),
           1
         )::float AS delivery_rate_pct,
         MAX(updated_at) AS last_event_at
       FROM platform.communication_deliveries
       WHERE requested_at >= NOW() - INTERVAL '7 days'
         AND (tenant_id = $1::uuid OR tenant_id IS NOT NULL)
       GROUP BY connector_key, channel
       ORDER BY connector_key, channel`,
      [effectiveContext.tenantId]
    );

    const items: FleetHealthItem[] = result.rows.map((row: any) => ({
      connectorKey: row.connector_key,
      channel: row.channel,
      total: row.total,
      delivered: row.delivered,
      failed: row.failed,
      inFlight: row.in_flight,
      deliveryRatePct: row.delivery_rate_pct,
      lastEventAt: row.last_event_at ? new Date(row.last_event_at).toISOString() : null,
    }));

    return NextResponse.json(items);
    });
  } catch (err: any) {
    if (err.denied) { const { body, status } = deniedResponse(err); return NextResponse.json(body, { status }); }

    console.error('Communications fleet health API error:', err);
    const denied: DeniedResult = { denied: true, reasonKey: 'INTERNAL_ERROR', message: 'An internal error occurred.' };
    return NextResponse.json(denied, { status: 500 });
  }
}
