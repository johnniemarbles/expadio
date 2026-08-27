import { NextResponse } from 'next/server';
import { allocatePlaneCapacity } from '@expadio/communication';
import { PostgresCommunicationThrottleRepository } from '@expadio/postgres-runtime';
import { dbPool } from '../../../../lib/iam-adapter';
import {
  resolveRequestContext,
  withTenantClient,
  deniedResponse,
} from '../../../../lib/request-context';

/**
 * Design spec §0.5 / BEMP §18 — plane health.
 *
 * "The screen an operator opens during an incident: queue depth, oldest queued
 * age, and dispatch p95 for each plane side by side. If bulk depth is rising
 * while transactional is flat, the partition is working. If both rise
 * together, it is not, and that is the alert."
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const context = await resolveRequestContext();
    const throttle = new PostgresCommunicationThrottleRepository(dbPool);

    const [transactional, bulk] = await Promise.all([
      throttle.peek({ tenantId: context.tenantId, plane: 'TRANSACTIONAL' }),
      throttle.peek({ tenantId: context.tenantId, plane: 'BULK' }),
    ]);

    const budget = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT transactional_floor_pct, transactional_max_per_minute, bulk_max_per_minute
           FROM platform.communication_plane_budgets
          WHERE tenant_id = $1::uuid
          ORDER BY connector_id LIMIT 1`,
        [context.tenantId],
      );
      return result.rows[0] ?? null;
    });

    const total = Number(budget?.transactional_max_per_minute ?? 1000);
    const allocation = allocatePlaneCapacity({
      totalPerMinute: total,
      transactionalFloorPct: Number(budget?.transactional_floor_pct ?? 30),
    });

    // The alert condition, computed rather than eyeballed.
    const partitionHolding = !(transactional.minuteCount > 0 && bulk.minuteCount > 0
      && transactional.minuteCount / Math.max(1, total) > 0.8
      && bulk.minuteCount / Math.max(1, allocation.bulkPerMinute) > 0.8);

    return NextResponse.json({
      planes: {
        TRANSACTIONAL: {
          consumedThisMinute: transactional.minuteCount,
          consumedToday: transactional.dayCount,
          capacityPerMinute: allocation.transactionalPerMinute,
          floorReserved: allocation.floorReserved,
        },
        BULK: {
          consumedThisMinute: bulk.minuteCount,
          consumedToday: bulk.dayCount,
          capacityPerMinute: allocation.bulkPerMinute,
          note: 'Bulk may only use headroom above the transactional floor. The floor is never borrowable.',
        },
      },
      partitionHolding,
      alert: partitionHolding
        ? null
        : 'Both planes are saturating together. The partition is not holding — check worker pool separation.',
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
