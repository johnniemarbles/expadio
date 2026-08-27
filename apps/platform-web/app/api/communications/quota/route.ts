import { NextResponse } from 'next/server';
import { PostgresCommunicationThrottleRepository } from '@expadio/postgres-runtime';
import { dbPool } from '../../../../lib/iam-adapter';
import {
  resolveRequestContext,
  withTenantClient,
  deniedResponse,
} from '../../../../lib/request-context';

/**
 * Design spec §8 — GET/PATCH quota.
 *
 * This endpoint READS consumption and WRITES bounds. It is not the enforcement
 * path: enforcement is `consume()` inside the dispatch transaction (§3.1 step
 * 13). A dashboard that shows "approaching limit" with no code path that stops
 * message 101 fails the definition of done, which is exactly where the
 * codebase was before migration 0041.
 *
 * §6.4 — every bound is returned alongside the platform maximum so the UI can
 * render it inline. Nothing is silently clamped.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PLATFORM_MAX_PER_MINUTE = 10_000;
const PLATFORM_MAX_PER_DAY = 500_000;

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const throttle = new PostgresCommunicationThrottleRepository(dbPool);

    const [transactional, bulk] = await Promise.all([
      throttle.peek({ tenantId: context.tenantId, plane: 'TRANSACTIONAL' }),
      throttle.peek({ tenantId: context.tenantId, plane: 'BULK' }),
    ]);

    const budgets = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT connector_id, transactional_floor_pct,
                transactional_max_per_minute, transactional_max_per_day,
                bulk_max_per_minute, bulk_max_per_day
           FROM platform.communication_plane_budgets
          WHERE tenant_id = $1::uuid`,
        [context.tenantId],
      );
      return result.rows;
    });

    return NextResponse.json({
      consumption: { transactional, bulk },
      budgets,
      platformBounds: {
        maxPerMinute: PLATFORM_MAX_PER_MINUTE,
        maxPerDay: PLATFORM_MAX_PER_DAY,
        transactionalFloorPctMinimum: 30,
      },
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = await request.json();

    const connectorId = typeof body.connectorId === 'string' ? body.connectorId : null;
    if (connectorId === null) {
      return NextResponse.json({ error: 'connectorId is required.' }, { status: 400 });
    }

    // §6.4 — a value above the bound is rejected WITH the bound stated,
    // never silently clamped.
    const perMinute = Number(body.transactionalMaxPerMinute ?? PLATFORM_MAX_PER_MINUTE);
    const perDay = Number(body.transactionalMaxPerDay ?? PLATFORM_MAX_PER_DAY);
    if (perMinute > PLATFORM_MAX_PER_MINUTE) {
      return NextResponse.json(
        { error: `Per-minute limit cannot exceed the platform maximum of ${PLATFORM_MAX_PER_MINUTE.toLocaleString('en-US')}.` },
        { status: 400 },
      );
    }
    if (perDay > PLATFORM_MAX_PER_DAY) {
      return NextResponse.json(
        { error: `Daily limit cannot exceed the platform maximum of ${PLATFORM_MAX_PER_DAY.toLocaleString('en-US')}.` },
        { status: 400 },
      );
    }

    // B16 — the transactional floor is never borrowable and cannot go below 30%.
    const floorPct = Number(body.transactionalFloorPct ?? 30);
    if (floorPct < 30) {
      return NextResponse.json(
        { error: 'The transactional floor cannot go below 30%. It is what stops a campaign delaying an OTP.' },
        { status: 400 },
      );
    }

    await withTenantClient(context, async (client) => {
      await client.query(
        `INSERT INTO platform.communication_plane_budgets
           (tenant_id, connector_id, transactional_floor_pct,
            transactional_max_per_minute, transactional_max_per_day,
            bulk_max_per_minute, bulk_max_per_day)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, connector_id) DO UPDATE
           SET transactional_floor_pct = EXCLUDED.transactional_floor_pct,
               transactional_max_per_minute = EXCLUDED.transactional_max_per_minute,
               transactional_max_per_day = EXCLUDED.transactional_max_per_day,
               bulk_max_per_minute = EXCLUDED.bulk_max_per_minute,
               bulk_max_per_day = EXCLUDED.bulk_max_per_day,
               updated_at = now()`,
        [
          context.tenantId, connectorId, floorPct, perMinute, perDay,
          body.bulkMaxPerMinute ?? null, body.bulkMaxPerDay ?? null,
        ],
      );
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
