import { NextResponse } from 'next/server';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

export async function GET() {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    return await withBrandTransaction(context, async (client) => {
      const result = await client.query(
        `SELECT priority, target_hours, escalation_hours, updated_at
           FROM platform.lead_task_sla_config
          WHERE tenant_id = $1::uuid AND organization_id = $2::uuid
          ORDER BY array_position(ARRAY['LOW','MEDIUM','HIGH','URGENT'], priority)`,
        [context.tenantId, context.organizationId],
      );
      return NextResponse.json({ slaConfig: result.rows.map((row) => ({
        priority: row.priority,
        targetHours: row.target_hours,
        escalationHours: row.escalation_hours,
        updatedAt: new Date(row.updated_at).toISOString(),
      })) });
    });
  } catch (error) {
    console.error('SLA config read failed:', error);
    return NextResponse.json({ error: 'Unable to load SLA configuration.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    if (!Array.isArray(body.entries) || body.entries.length === 0) {
      return NextResponse.json({ error: 'entries must be a non-empty array of {priority, targetHours, escalationHours}.' }, { status: 400 });
    }
    const entries: { priority: string; targetHours: number; escalationHours: number }[] = [];
    for (const e of body.entries) {
      const priority = typeof e.priority === 'string' ? e.priority.toUpperCase() : '';
      if (!PRIORITIES.includes(priority as (typeof PRIORITIES)[number])) {
        return NextResponse.json({ error: `Invalid priority '${e.priority}'.` }, { status: 400 });
      }
      const targetHours = typeof e.targetHours === 'number' ? Math.floor(e.targetHours) : 0;
      const escalationHours = typeof e.escalationHours === 'number' ? Math.floor(e.escalationHours) : 0;
      if (targetHours <= 0 || escalationHours < targetHours) {
        return NextResponse.json({ error: `priority '${priority}': targetHours must be > 0 and escalationHours >= targetHours.` }, { status: 400 });
      }
      entries.push({ priority, targetHours, escalationHours });
    }
    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId!)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }
      for (const { priority, targetHours, escalationHours } of entries) {
        await client.query(
          `INSERT INTO platform.lead_task_sla_config
             (tenant_id, organization_id, priority, target_hours, escalation_hours)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5)
           ON CONFLICT (tenant_id, organization_id, priority)
           DO UPDATE SET target_hours = EXCLUDED.target_hours,
                         escalation_hours = EXCLUDED.escalation_hours,
                         updated_at = now()`,
          [context.tenantId, context.organizationId, priority, targetHours, escalationHours],
        );
      }
      return NextResponse.json({ success: true, updated: entries.length });
    });
  } catch (error) {
    console.error('SLA config update failed:', error);
    return NextResponse.json({ error: 'Unable to update SLA configuration.' }, { status: 500 });
  }
}
