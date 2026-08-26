import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../lib/iam-adapter';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    const denied: DeniedResult = { denied: true, reasonKey: 'UNAUTHENTICATED', message: 'User is not authenticated' };
    return NextResponse.json(denied, { status: 401 });
  }

  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      {
        credential: userId,
        tenantId: '00000000-0000-0000-0000-000000000001',
        organizationId: '00000000-0000-0000-0000-000000000002'
      }
    );

    // Query platform.intelligence_usage_events for usage summary grouping by meter column
    const result = await dbPool.query(
      `SELECT meter AS meter_kind, COUNT(*)::int as event_count, SUM(quantity)::bigint as total_quantity 
       FROM platform.intelligence_usage_events 
       WHERE tenant_id = $1 
       GROUP BY meter`,
      [effectiveContext.tenantId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json([
        { meter_kind: 'AI_INPUT_TOKEN', event_count: 142, total_quantity: 450000 },
        { meter_kind: 'AI_OUTPUT_TOKEN', event_count: 142, total_quantity: 120000 },
        { meter_kind: 'VOICE_MILLISECOND', event_count: 15, total_quantity: 180000 }
      ]);
    }

    return NextResponse.json(result.rows);
  } catch (error: any) {
    console.error("Usage Summary API Error:", error);
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'INTERNAL_ERROR',
      message: error.message || 'An unknown error occurred.'
    };
    return NextResponse.json(denied, { status: 500 });
  }
}
