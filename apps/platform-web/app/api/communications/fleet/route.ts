import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../lib/iam-adapter';

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

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    const denied: DeniedResult = { denied: true, reasonKey: 'UNAUTHENTICATED', message: 'Not authenticated' };
    return NextResponse.json(denied, { status: 401 });
  }

  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
    );

    const result = await dbPool.query(
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

    if (result.rows.length === 0) {
      // Seed operational sample rows for the platform overview
      const fallback: FleetHealthItem[] = [
        {
          connectorKey: 'conn-resend',
          channel: 'email',
          total: 0,
          delivered: 0,
          failed: 0,
          inFlight: 0,
          deliveryRatePct: null,
          lastEventAt: null,
        },
        {
          connectorKey: 'conn-twilio-sms',
          channel: 'sms',
          total: 0,
          delivered: 0,
          failed: 0,
          inFlight: 0,
          deliveryRatePct: null,
          lastEventAt: null,
        },
      ];
      return NextResponse.json(fallback);
    }

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
  } catch (err: any) {
    console.error('Communications fleet health API error:', err);
    const denied: DeniedResult = { denied: true, reasonKey: 'INTERNAL_ERROR', message: err.message };
    return NextResponse.json(denied, { status: 500 });
  }
}
