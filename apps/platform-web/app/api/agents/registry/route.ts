import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../lib/iam-adapter';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true, reasonKey: 'UNAUTHENTICATED' }, { status: 401 });

  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
    );

    const result = await dbPool.query(
      `SELECT
         assigned_agent_id,
         COUNT(*)::int                                                         AS task_count,
         COUNT(*) FILTER (WHERE status = 'COMPLETED')::int                    AS completed_count,
         COUNT(*) FILTER (WHERE status = 'FAILED')::int                       AS failed_count,
         COUNT(*) FILTER (WHERE status IN ('RUNNING','IN_PROGRESS'))::int     AS active_count,
         MAX(created_at)                                                       AS last_seen
       FROM platform.agent_tasks
       WHERE tenant_id = $1
       GROUP BY assigned_agent_id
       ORDER BY last_seen DESC`,
      [effectiveContext.tenantId]
    );

    return NextResponse.json(result.rows);
  } catch (err: any) {
    return NextResponse.json({ denied: true, reasonKey: 'INTERNAL_ERROR', message: err.message }, { status: 500 });
  }
}
