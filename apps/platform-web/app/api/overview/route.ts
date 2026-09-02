import { NextResponse } from 'next/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { ContextDenied, resolveRequestContext, deniedResponse, withTenantTransaction } from '../../../lib/request-context';
import { dbPool } from '../../../lib/iam-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);
    if (!effectiveContext.organizationId) {
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
      && requestedOrganizationId !== effectiveContext.organizationId
    ) {
      throw new ContextDenied(
        'TENANT_ACCESS_DENIED',
        'You do not have access to this workspace.',
        403,
      );
    }

    // The membership-resolved context is authoritative. Query parameters may
    // request that same organization, but cannot select a second organization.
    const orgId = effectiveContext.organizationId;

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
      withTenantTransaction(effectiveContext, (client) =>
        client.query(
          'SELECT COUNT(*)::int AS cnt FROM platform.agent_runs WHERE tenant_id = $1 AND organization_id = $2',
          [effectiveContext.tenantId, orgId],
        ),
      )
    ]);

    const org = orgResult.rows[0];
    const orgName = org ? org.name : 'Dreamware Platform';

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
      `SELECT proposal_reference, proposer_subject_id, created_at FROM platform.company_brain_correction_proposals
       WHERE tenant_id = $1 AND status = 'UNREVIEWED' ORDER BY created_at DESC LIMIT 3`,
      [effectiveContext.tenantId]
    );
    const reviews = topReviewsRes.rows.map((row: any) => ({
      id: row.proposal_reference,
      title: 'Review Correction Proposal',
      category: 'Company Brain',
      requestedBy: row.proposer_subject_id || 'System',
      age: row.created_at,
      risk: 'Medium'
    }));

    const topActivityRes = await withTenantTransaction(effectiveContext, (client) =>
      client.query(
        `SELECT event_id, event_type, event_reference, occurred_at, actor_subject_id, reason
           FROM platform.agent_run_events
          WHERE tenant_id = $1
            AND organization_id = $2
          ORDER BY occurred_at DESC
          LIMIT 3`,
        [effectiveContext.tenantId, orgId],
      ),
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
    if (error?.denied) {
      const { body, status } = deniedResponse(error);
      return NextResponse.json(body, { status });
    }
    console.error("Overview API Error:", error);
    const denied: DeniedResult = { denied: true, reasonKey: 'INTERNAL_ERROR', message: error.message || 'An unknown error occurred.' };
    return NextResponse.json(denied, { status: 500 });
  }
}
