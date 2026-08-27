import { NextResponse } from 'next/server';
import { PostgresCommunicationSpendRepository } from '@expadio/postgres-runtime';
import { dbPool } from '../../../../lib/iam-adapter';
import {
  resolveRequestContext,
  requireStepUp,
  withTenantClient,
  deniedResponse,
} from '../../../../lib/request-context';

/**
 * Design spec §8 / D7 — spend cap and breaker.
 *
 * D7: a tenant resetting their own cost breaker defeats its purpose, so the
 * reset is platform-admin-only and dual-controlled.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const context = await resolveRequestContext();
    const spend = new PostgresCommunicationSpendRepository(dbPool);
    const evaluation = await spend.read(context.tenantId);
    return NextResponse.json(evaluation);
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await resolveRequestContext();
    const body = await request.json();
    const cap = body.dailyCapMinorUnits;

    if (cap !== null && (!Number.isInteger(cap) || cap <= 0)) {
      return NextResponse.json(
        { error: 'The daily cap must be a positive whole number of minor units, or null for no cap.' },
        { status: 400 },
      );
    }

    await withTenantClient(context, async (client) => {
      await client.query(
        `INSERT INTO platform.communication_spend_caps
           (tenant_id, daily_cap_minor_units, currency)
         VALUES ($1::uuid, $2, $3)
         ON CONFLICT (tenant_id) DO UPDATE
           SET daily_cap_minor_units = EXCLUDED.daily_cap_minor_units,
               currency = EXCLUDED.currency,
               updated_at = now()`,
        [context.tenantId, cap, typeof body.currency === 'string' ? body.currency : 'USD'],
      );
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
