import { NextResponse } from 'next/server';
import type { ActivityItem } from '../../../lib/contracts';
import {
  ContextDenied,
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    if (!context.organizationId) {
      throw new ContextDenied(
        'ORGANIZATION_CONTEXT_REQUIRED',
        'Select an organization workspace to continue.',
        403,
      );
    }

    const { searchParams } = new URL(request.url);
    const requestedOrganizationId = searchParams.get('organizationId');
    if (
      requestedOrganizationId
      && requestedOrganizationId !== context.organizationId
    ) {
      throw new ContextDenied(
        'TENANT_ACCESS_DENIED',
        'You do not have access to this workspace.',
        403,
      );
    }

    const { agentRows, readRows } = await withTenantTransaction(context, async (client) => {
      const agentEventsRes = await client.query(
        `SELECT e.event_id as id, e.event_type as action, e.event_reference as target,
                e.occurred_at as time, e.actor_subject_id as actor
           FROM platform.agent_run_events e
           JOIN platform.agent_runs r
             ON e.run_id = r.run_id
            AND e.tenant_id = r.tenant_id
          WHERE e.tenant_id = $1
            AND e.organization_id = $2
            AND r.organization_id = $2
          ORDER BY e.occurred_at DESC
          LIMIT 25`,
        [context.tenantId, context.organizationId],
      );

      const readEventsRes = await client.query(
        `SELECT event_id as id, outcome, resource_type, resource_id,
                recorded_at as time, requested_by_subject_id as actor
           FROM platform.sensitive_read_events
          WHERE tenant_id = $1
            AND organization_id = $2
          ORDER BY recorded_at DESC
          LIMIT 25`,
        [context.tenantId, context.organizationId],
      );

      return { agentRows: agentEventsRes.rows, readRows: readEventsRes.rows };
    });

    const items: ActivityItem[] = [];

    for (const row of agentRows as any[]) {
      if (!row.id || !row.actor || !row.action || !row.target || !row.time) {
        throw new Error('Activity evidence is incomplete.');
      }
      items.push({
        id: String(row.id),
        actor: String(row.actor),
        action: String(row.action).toLowerCase().replace(/_/g, ' '),
        target: String(row.target),
        time: new Date(row.time).toISOString(),
      });
    }

    for (const row of readRows as any[]) {
      if (!row.id || !row.actor || !row.outcome || !row.resource_type || !row.resource_id || !row.time) {
        throw new Error('Activity evidence is incomplete.');
      }
      items.push({
        id: String(row.id),
        actor: String(row.actor),
        action: `read access ${String(row.outcome).toLowerCase()}`,
        target: `${String(row.resource_type)} ${String(row.resource_id)}`,
        time: new Date(row.time).toISOString(),
      });
    }

    items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    return NextResponse.json(items.slice(0, 50), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
