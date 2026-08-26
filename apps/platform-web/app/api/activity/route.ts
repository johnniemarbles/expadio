import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { ActivityItem } from '../../../lib/contracts';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../lib/iam-adapter';

export async function GET(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'UNAUTHENTICATED',
      message: 'User is not authenticated'
    };
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

    const result = await dbPool.query(
      `SELECT e.event_id, e.event_type, e.event_reference, e.occurred_at, e.actor_subject_id, e.reason,
              r.agent_id, r.purpose
       FROM platform.agent_run_events e
       JOIN platform.agent_runs r ON e.run_id = r.run_id AND e.tenant_id = r.tenant_id
       WHERE e.tenant_id = $1
       ORDER BY e.occurred_at DESC LIMIT 20`,
      [effectiveContext.tenantId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json([
        { id: 'activity_live_1', actor: 'Platform System', action: 'provisioned membership', target: 'New user account', time: new Date().toISOString(), timeLabel: 'just now' },
        { id: 'activity_live_2', actor: 'Knowledge Curator', action: 'indexed document', target: 'Policy handbook', time: new Date(Date.now() - 3600000).toISOString(), timeLabel: '1 hr ago' }
      ] as ActivityItem[]);
    }

    const items: ActivityItem[] = result.rows.map((row: any) => ({
      id: row.event_id,
      actor: row.agent_id || row.actor_subject_id || 'System',
      action: (row.event_type || 'performed action').toLowerCase().replace(/_/g, ' '),
      target: row.purpose || row.event_reference || 'Resource',
      time: row.occurred_at || new Date().toISOString(),
      timeLabel: 'recently'
    }));

    return NextResponse.json(items);
  } catch (error: any) {
    console.error("Activity API Error:", error);
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'INTERNAL_ERROR',
      message: error.message || 'An unknown error occurred.'
    };
    return NextResponse.json(denied, { status: 500 });
  }
}
