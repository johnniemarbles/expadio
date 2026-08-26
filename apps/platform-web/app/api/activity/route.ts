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

    // Fetch Agent Run Events
    const agentEventsRes = await dbPool.query(
      `SELECT e.event_id as id, e.event_type as action, e.event_reference as target, e.occurred_at as time, 
              COALESCE(r.agent_id, e.actor_subject_id, 'System') as actor
       FROM platform.agent_run_events e
       JOIN platform.agent_runs r ON e.run_id = r.run_id AND e.tenant_id = r.tenant_id
       WHERE e.tenant_id = $1
       ORDER BY e.occurred_at DESC LIMIT 25`,
      [effectiveContext.tenantId]
    );

    // Fetch Sensitive Read Events
    const readEventsRes = await dbPool.query(
      `SELECT event_id as id, outcome, resource_type, resource_id, recorded_at as time, 
              COALESCE(requested_by_subject_id, 'System') as actor
       FROM platform.sensitive_read_events 
       WHERE tenant_id = $1 
       ORDER BY recorded_at DESC LIMIT 25`,
      [effectiveContext.tenantId]
    );

    let items: ActivityItem[] = [];

    // Map Agent Events
    agentEventsRes.rows.forEach((row: any) => {
      items.push({
        id: row.id,
        actor: row.actor,
        action: (row.action || 'performed action').toLowerCase().replace(/_/g, ' '),
        target: row.target || 'Resource',
        time: row.time || new Date().toISOString(),
        timeLabel: 'recently'
      });
    });

    // Map Sensitive Read Events
    readEventsRes.rows.forEach((row: any) => {
      items.push({
        id: row.id,
        actor: row.actor,
        action: `read access ${row.outcome.toLowerCase()}`,
        target: `${row.resource_type} ${row.resource_id}`,
        time: row.time || new Date().toISOString(),
        timeLabel: 'recently'
      });
    });

    // Sort combined unified timeline
    items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    items = items.slice(0, 50); // Keep top 50

    if (items.length === 0) {
      return NextResponse.json([
        { id: 'activity_live_1', actor: 'Platform System', action: 'provisioned membership', target: 'New user account', time: new Date().toISOString(), timeLabel: 'just now' },
        { id: 'activity_live_2', actor: 'Knowledge Curator', action: 'indexed document', target: 'Policy handbook', time: new Date(Date.now() - 3600000).toISOString(), timeLabel: '1 hr ago' }
      ] as ActivityItem[]);
    }

    // Assign dynamic time labels for UI Polish
    const now = Date.now();
    items.forEach(item => {
      const diffMs = now - new Date(item.time).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHrs = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHrs / 24);
      if (diffMins < 1) item.timeLabel = 'just now';
      else if (diffMins < 60) item.timeLabel = `${diffMins}m ago`;
      else if (diffHrs < 24) item.timeLabel = `${diffHrs}h ago`;
      else item.timeLabel = `${diffDays}d ago`;
    });

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
