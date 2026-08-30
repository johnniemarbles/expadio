import { NextResponse } from 'next/server';
import { deniedResponse, resolveRequestContext, withTenantClient } from '../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const contextState = await resolveRequestContext(request);
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('organizationId')?.trim() || contextState.organizationId || '';

    const overviewData = await withTenantClient(contextState, async (client) => {
      const [orgResult, capResult, corrResult, runResult] = await Promise.all([
        orgId
          ? client.query(
              'SELECT organization_id, name, status FROM platform.organizations WHERE organization_id = $1 AND tenant_id = $2',
              [orgId, contextState.tenantId]
            )
          : Promise.resolve({ rows: [] }),
        client.query(
          'SELECT state, COUNT(*)::int AS cnt FROM platform.capability_state WHERE tenant_id = $1 GROUP BY state',
          [contextState.tenantId]
        ),
        client.query(
          `SELECT COUNT(*)::int AS cnt FROM platform.company_brain_correction_proposals WHERE tenant_id = $1 AND status = 'UNREVIEWED'`,
          [contextState.tenantId]
        ),
        client.query(
          'SELECT COUNT(*)::int AS cnt FROM platform.agent_runs WHERE tenant_id = $1',
          [contextState.tenantId]
        )
      ]);

      const topCaps = await client.query(
        `SELECT binding_id, state, resolved_at FROM platform.capability_state WHERE tenant_id = $1 ORDER BY resolved_at DESC LIMIT 3`,
        [contextState.tenantId]
      );

      const topReviewsRes = await client.query(
        `SELECT proposal_reference, proposer_subject_id, created_at FROM platform.company_brain_correction_proposals 
         WHERE tenant_id = $1 AND status = 'UNREVIEWED' ORDER BY created_at DESC LIMIT 3`,
        [contextState.tenantId]
      );

      const topActivityRes = await client.query(
        `SELECT event_id, event_type, event_reference, occurred_at, actor_subject_id, reason
         FROM platform.agent_run_events 
         WHERE tenant_id = $1 ORDER BY occurred_at DESC LIMIT 3`,
        [contextState.tenantId]
      );

      return { orgResult, capResult, corrResult, runResult, topCaps, topReviewsRes, topActivityRes };
    });

    const { orgResult, capResult, corrResult, runResult, topCaps, topReviewsRes, topActivityRes } = overviewData;

    const org = orgResult.rows[0];
    const orgName = org ? org.name : 'Selected Workspace';

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

    const capabilities = topCaps.rows.map((row: any) => ({
      id: row.binding_id,
      name: 'Governed Capability',
      kind: 'Worker',
      version: '1.0.0',
      state: row.state === 'ACTIVE' ? 'Published' : 'Review',
      scope: 'Global',
      updated: row.resolved_at || new Date().toISOString(),
    }));

    const reviews = topReviewsRes.rows.map((row: any) => ({
      id: row.proposal_reference,
      title: 'Review Correction Proposal',
      category: 'Company Brain',
      requestedBy: row.proposer_subject_id || 'System',
      age: row.created_at,
      risk: 'Medium'
    }));

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
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
