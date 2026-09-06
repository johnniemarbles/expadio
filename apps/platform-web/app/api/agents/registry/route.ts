import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { dbPool } from '../../../../lib/iam-adapter';
import { resolveRequestContext, deniedResponse } from '../../../../lib/request-context';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true, reasonKey: 'UNAUTHENTICATED' }, { status: 401 });

  try {
    const effectiveContext = await resolveRequestContext(request);

    const result = await dbPool.query(
      `WITH task_stats AS (
         SELECT
           assigned_agent_id,
           COUNT(*)::int                                                         AS task_count,
           COUNT(*) FILTER (WHERE status = 'COMPLETED')::int                    AS completed_count,
           COUNT(*) FILTER (WHERE status = 'FAILED')::int                       AS failed_count,
           COUNT(*) FILTER (WHERE status IN ('RUNNING','IN_PROGRESS'))::int     AS active_count,
           MAX(created_at)                                                       AS last_seen
         FROM platform.agent_tasks
         WHERE tenant_id = $1
         GROUP BY assigned_agent_id
       )
       SELECT
         t.*,
         COALESCE(a.persona, c.display_name, t.assigned_agent_id) AS display_name,
         COALESCE(a.department, c.department, 'System') AS department
       FROM task_stats t
       LEFT JOIN platform.agent_definitions a ON a.slug = t.assigned_agent_id
       LEFT JOIN platform.capabilities c ON c.capability_key = t.assigned_agent_id
       ORDER BY t.last_seen DESC`,
      [effectiveContext.tenantId]
    );

    return NextResponse.json(result.rows);
  } catch (err: any) {
    const resp = deniedResponse(err);
    return NextResponse.json(resp.body, { status: resp.status });
  }
}
