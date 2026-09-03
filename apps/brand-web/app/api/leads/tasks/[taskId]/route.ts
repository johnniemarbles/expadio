import { NextResponse } from 'next/server';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Complete or cancel a task. */
export async function PATCH(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    const taskId = (await params).taskId.trim();
    if (!UUID.test(taskId)) return NextResponse.json({ error: 'A valid taskId is required.' }, { status: 400 });
    const body = await request.json().catch(() => ({}));
    const status = typeof body.status === 'string' ? body.status.trim().toUpperCase() : '';
    if (status !== 'DONE' && status !== 'CANCELLED' && status !== 'OPEN') {
      return NextResponse.json({ error: "status must be 'OPEN', 'DONE', or 'CANCELLED'." }, { status: 400 });
    }
    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId!)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }
      const updated = await client.query(
        `UPDATE platform.lead_tasks
            SET status = $4,
                completed_at = CASE WHEN $4 = 'DONE' THEN now() ELSE NULL END,
                updated_at = now()
          WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND task_id = $3::uuid
          RETURNING task_id, status, completed_at`,
        [context.tenantId, context.organizationId, taskId, status],
      );
      if (updated.rowCount === 0) return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
      const row = updated.rows[0];
      return NextResponse.json({ success: true, taskId: row.task_id, status: row.status, completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null });
    });
  } catch (error) {
    console.error('Lead task update failed:', error);
    return NextResponse.json({ error: 'Unable to update the task.' }, { status: 500 });
  }
}
