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
  const resolve = () => authenticateAndResolveContext(
    { identityVerifier, membershipRepository },
    { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
  );
  try {
    const effectiveContext = await resolve();
    // Query latest AI job execution pipelines
    const result = await dbPool.query(
      `SELECT j.job_id, j.operation, j.purpose, j.created_at,
              (SELECT e.event_type FROM platform.ai_job_events e 
               WHERE e.job_id = j.job_id AND e.tenant_id = j.tenant_id 
               ORDER BY e.sequence DESC LIMIT 1) as status
       FROM platform.ai_jobs j
       WHERE j.tenant_id = $1
       ORDER BY j.created_at DESC LIMIT 20`,
      [effectiveContext.tenantId]
    );

    const pipelines = result.rows.map((row: any) => ({
      id: row.job_id.split('-')[0], // Shorten ID for display
      name: row.purpose,
      status: row.status || 'STARTED',
      currentStage: row.operation,
      totalStages: 1
    }));

    // Fallback if empty DB
    if (pipelines.length === 0) {
      return NextResponse.json([
        { id: 'pipe-001', name: 'Customer Sentiment Analysis', status: 'RUNNING', currentStage: 'CLASSIFY', totalStages: 1 },
        { id: 'pipe-002', name: 'Invoice Data Extraction', status: 'SUCCEEDED', currentStage: 'EXTRACT', totalStages: 1 }
      ]);
    }

    return NextResponse.json(pipelines);
  } catch (error: any) {
    const denied: DeniedResult = { denied: true, reasonKey: 'INTERNAL_ERROR', message: error.message || 'Unknown error' };
    return NextResponse.json(denied, { status: 500 });
  }
}
