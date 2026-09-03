import { NextResponse } from 'next/server';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

/** Update task status, priority, or escalation flag. All fields are optional; at least one must be present. */
export async function PATCH(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    const taskId = (await params).taskId.trim();
    if (!UUID.test(taskId)) return NextResponse.json({ error: 'A valid taskId is required.' }, { status: 400 });
    const body = await request.json().catch(() => ({}));

    const statusRaw = typeof body.status === 'string' ? body.status.trim().toUpperCase() : undefined;
    if (statusRaw !== undefined && statusRaw !== 'DONE' && statusRaw !== 'CANCELLED' && statusRaw !== 'OPEN') {
      return NextResponse.json({ error: "status must be 'OPEN', 'DONE', or 'CANCELLED'." }, { status: 400 });
    }

    const priorityRaw = typeof body.priority === 'string' ? body.priority.trim().toUpperCase() : undefined;
    if (priorityRaw !== undefined && !PRIORITIES.has(priorityRaw)) {
      return NextResponse.json({ error: "priority must be 'LOW', 'MEDIUM', 'HIGH', or 'URGENT'." }, { status: 400 });
    }

    const escalate = body.escalate === true;
    const deescalate = body.escalate === false;

    if (statusRaw === undefined && priorityRaw === undefined && !escalate && !deescalate) {
      return NextResponse.json({ error: 'At least one of status, priority, or escalate is required.' }, { status: 400 });
    }

    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId!)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }

      const sets: string[] = ['updated_at = now()'];
      const values: unknown[] = [context.tenantId, context.organizationId, taskId];

      if (statusRaw !== undefined) {
        values.push(statusRaw);
        sets.push(`status = $${values.length}`);
        sets.push(`completed_at = CASE WHEN $${values.length} = 'DONE' THEN now() ELSE NULL END`);
      }
      if (priorityRaw !== undefined) {
        values.push(priorityRaw);
        sets.push(`priority = $${values.length}`);
      }
      if (escalate) {
        sets.push('escalated_at = now()');
      } else if (deescalate) {
        sets.push('escalated_at = NULL');
      }

      const updated = await client.query(
        `UPDATE platform.lead_tasks
            SET ${sets.join(', ')}
          WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND task_id = $3::uuid
          RETURNING task_id, status, priority, completed_at, escalated_at,
                    platform.lead_task_sla_status(status, due_at, escalated_at) AS sla_status`,
        values,
      );
      if (updated.rowCount === 0) return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
      const row = updated.rows[0];
      return NextResponse.json({
        success: true,
        taskId: row.task_id,
        status: row.status,
        priority: row.priority,
        slaStatus: row.sla_status,
        completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
        escalatedAt: row.escalated_at ? new Date(row.escalated_at).toISOString() : null,
      });
    });
  } catch (error) {
    console.error('Lead task update failed:', error);
    return NextResponse.json({ error: 'Unable to update the task.' }, { status: 500 });
  }
}
