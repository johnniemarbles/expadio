import { NextResponse } from 'next/server';
import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Hierarchy-safe lead analytics rollup.
 *
 * Returns funnel counts, task queue summary, and top attribution sources
 * for the caller's authorized organization subtree. All queries go through
 * the _rollup views which join via organization_closure, so ancestor orgs
 * see totals across all descendants without bypassing RLS on base tables.
 */
export async function GET() {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    return await withBrandTransaction(context, async (client) => {
      const [funnel, tasks, sources] = await Promise.all([
        client.query(
          `SELECT total_leads, verified_leads, unverified_leads, auto_verified_leads, unique_contacts
             FROM platform.lead_capture_funnel_rollup
            WHERE tenant_id = $1::uuid AND organization_id = $2::uuid`,
          [context.tenantId, context.organizationId],
        ),
        client.query(
          `SELECT priority, status, task_count, overdue_count, escalated_count
             FROM platform.lead_task_queue_rollup
            WHERE tenant_id = $1::uuid AND organization_id = $2::uuid
            ORDER BY array_position(ARRAY['URGENT','HIGH','MEDIUM','LOW'], priority), status`,
          [context.tenantId, context.organizationId],
        ),
        client.query(
          `SELECT channel, surface, lead_count, verified_count
             FROM platform.lead_attribution_source_rollup
            WHERE tenant_id = $1::uuid AND organization_id = $2::uuid
            ORDER BY lead_count DESC
            LIMIT 20`,
          [context.tenantId, context.organizationId],
        ),
      ]);

      const funnelRow = funnel.rows[0] ?? { total_leads: 0, verified_leads: 0, unverified_leads: 0, auto_verified_leads: 0, unique_contacts: 0 };

      return NextResponse.json({
        funnel: {
          totalLeads: Number(funnelRow.total_leads),
          verifiedLeads: Number(funnelRow.verified_leads),
          unverifiedLeads: Number(funnelRow.unverified_leads),
          autoVerifiedLeads: Number(funnelRow.auto_verified_leads),
          uniqueContacts: Number(funnelRow.unique_contacts),
        },
        taskQueue: tasks.rows.map((r) => ({
          priority: r.priority,
          status: r.status,
          count: Number(r.task_count),
          overdueCount: Number(r.overdue_count),
          escalatedCount: Number(r.escalated_count),
        })),
        attributionSources: sources.rows.map((r) => ({
          channel: r.channel,
          surface: r.surface,
          leadCount: Number(r.lead_count),
          verifiedCount: Number(r.verified_count),
        })),
      });
    });
  } catch (error) {
    console.error('Lead analytics failed:', error);
    return NextResponse.json({ error: 'Unable to load analytics.' }, { status: 500 });
  }
}
