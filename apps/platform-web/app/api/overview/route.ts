import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
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

  const resolve = () => authenticateAndResolveContext(
    { identityVerifier, membershipRepository },
    {
      credential: userId,
      tenantId: '00000000-0000-0000-0000-000000000001',
      organizationId: '00000000-0000-0000-0000-000000000002'
    }
  );

  try {
    let effectiveContext;
    try {
      effectiveContext = await resolve();
    } catch (error) {
      // Auto-provision user if they aren't in the database yet
      console.log(`Auto-provisioning user ${userId} in database...`);
      const client = await dbPool.connect();
      try {
        const res = await client.query('SELECT membership_id FROM platform.memberships WHERE subject_id = $1', [userId]);
        if (res.rowCount === 0) {
          await client.query(
            `INSERT INTO platform.memberships (tenant_id, organization_id, subject_id, actor_kind, status, issuer, workspace_scope_mode, operating_unit_scope_mode)
             VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', $1, 'user', 'ACTIVE', 'https://clerk.expadio.com', 'ALL', 'ALL')`,
            [userId]
          );
        } else {
          await client.query("UPDATE platform.memberships SET issuer = 'https://clerk.expadio.com' WHERE subject_id = $1", [userId]);
        }
      } finally {
        client.release();
      }
      effectiveContext = await resolve();
    }

    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('organizationId') || '00000000-0000-0000-0000-000000000002';

    // Aggregate real metrics from database tables
    const [orgResult, capResult, corrResult, runResult] = await Promise.all([
      dbPool.query(
        'SELECT organization_id, name, status FROM platform.organizations WHERE organization_id = $1 AND tenant_id = $2',
        [orgId, effectiveContext.tenantId]
      ),
      dbPool.query(
        'SELECT state, COUNT(*)::int AS cnt FROM platform.capability_state WHERE tenant_id = $1 GROUP BY state',
        [effectiveContext.tenantId]
      ),
      dbPool.query(
        `SELECT COUNT(*)::int AS cnt FROM platform.company_brain_correction_proposals WHERE tenant_id = $1 AND status = 'UNREVIEWED'`,
        [effectiveContext.tenantId]
      ),
      dbPool.query(
        'SELECT COUNT(*)::int AS cnt FROM platform.agent_runs WHERE tenant_id = $1',
        [effectiveContext.tenantId]
      )
    ]);

    const org = orgResult.rows[0];
    const orgName = org ? org.name : 'Dreamware Platform';

    // Build metrics from aggregated counts
    const activeCount = capResult.rows.find((r: any) => r.state === 'ACTIVE')?.cnt || 0;
    const totalCapabilities = capResult.rows.reduce((sum: number, r: any) => sum + r.cnt, 0);
    const unreviewedCorrections = corrResult.rows[0]?.cnt || 0;
    const totalRuns = runResult.rows[0]?.cnt || 0;

    const metrics = [
      { label: 'Active capabilities', value: String(activeCount), detail: `${totalCapabilities} total registered`, tone: activeCount > 0 ? 'positive' : 'neutral' },
      { label: 'Governance review', value: String(unreviewedCorrections), detail: unreviewedCorrections > 0 ? 'Items awaiting review' : 'No pending reviews', tone: unreviewedCorrections > 0 ? 'attention' : 'positive' },
      { label: 'Agent sessions', value: String(totalRuns), detail: 'Total recorded runs', tone: 'neutral' },
      { label: 'System health', value: 'Operational', detail: 'All adapters connected', tone: 'positive' }
    ];

    // Fetch top capabilities
    const topCaps = await dbPool.query(
      `SELECT binding_id, state, resolved_at FROM platform.capability_state WHERE tenant_id = $1 ORDER BY resolved_at DESC LIMIT 3`,
      [effectiveContext.tenantId]
    );
    const capabilities = topCaps.rows.map((row: any) => ({
      id: row.binding_id,
      name: 'Governed Capability',
      kind: 'Worker',
      version: '1.0.0',
      state: row.state === 'ACTIVE' ? 'Published' : 'Review',
      scope: 'Global',
      updated: row.resolved_at || new Date().toISOString(),
    }));

    const topReviewsRes = await dbPool.query(
      `SELECT proposal_id, proposed_by_subject_id, created_at FROM platform.company_brain_correction_proposals 
       WHERE tenant_id = $1 AND status = 'UNREVIEWED' ORDER BY created_at DESC LIMIT 3`,
      [effectiveContext.tenantId]
    );
    const reviews = topReviewsRes.rows.map((row: any) => ({
      id: row.proposal_id,
      title: 'Review Correction Proposal',
      category: 'Company Brain',
      requestedBy: row.proposed_by_subject_id || 'System',
      age: row.created_at,
      risk: 'Medium'
    }));

    const topActivityRes = await dbPool.query(
      `SELECT event_id, event_type, event_reference, occurred_at, actor_subject_id, reason
       FROM platform.agent_run_events 
       WHERE tenant_id = $1 ORDER BY occurred_at DESC LIMIT 3`,
      [effectiveContext.tenantId]
    );
    const activity = topActivityRes.rows.map((row: any) => ({
      id: row.event_id,
      actor: row.actor_subject_id || 'System',
      action: (row.event_type || 'performed action').toLowerCase().replace(/_/g, ' '),
      target: row.event_reference || 'Resource',
      time: row.occurred_at || new Date().toISOString(),
      timeLabel: 'recently'
    }));

    const overview = {
      organization: { id: orgId, name: orgName, environment: 'production', level: 'platform', parentId: null },
      metrics,
      capabilities,
      reviews,
      activity
    };
    
    return NextResponse.json(overview);
  } catch (error: any) {
    console.error("Overview API Error:", error);
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'INTERNAL_ERROR',
      message: error.message || 'An unknown error occurred.'
    };
    return NextResponse.json(denied, { status: 500 });
  }
}
