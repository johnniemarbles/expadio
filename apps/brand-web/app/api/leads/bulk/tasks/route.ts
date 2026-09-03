import { NextResponse } from 'next/server';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_BULK = 200;

/**
 * POST — create the same task on multiple capture leads at once.
 * Body: { captureLeadIds: string[], title, description?, assigneeSubjectId?, dueAt?, priority? }
 */
export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    const body = await request.json().catch(() => ({}));

    const ids: string[] = Array.isArray(body.captureLeadIds)
      ? (body.captureLeadIds as unknown[]).filter((id): id is string => typeof id === 'string' && UUID.test(id))
      : [];
    if (ids.length === 0) return NextResponse.json({ error: 'captureLeadIds must be a non-empty array of valid UUIDs.' }, { status: 400 });
    if (ids.length > MAX_BULK) return NextResponse.json({ error: `Bulk task creation is limited to ${MAX_BULK} leads per request.` }, { status: 400 });

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > 200) return NextResponse.json({ error: 'A task title (1-200 chars) is required.' }, { status: 400 });
    const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim().slice(0, 5000) : null;
    const assignee = typeof body.assigneeSubjectId === 'string' && body.assigneeSubjectId.trim() ? body.assigneeSubjectId.trim() : null;
    const priority = typeof body.priority === 'string' && ['LOW','MEDIUM','HIGH','URGENT'].includes(body.priority.toUpperCase())
      ? body.priority.toUpperCase() : 'MEDIUM';
    let dueAt: string | null = null;
    if (typeof body.dueAt === 'string' && body.dueAt.trim()) {
      const parsed = new Date(body.dueAt);
      if (Number.isNaN(parsed.getTime())) return NextResponse.json({ error: 'dueAt is not a valid date.' }, { status: 400 });
      dueAt = parsed.toISOString();
    }

    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId!)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }

      // Verify all lead IDs are in-scope in one query before inserting.
      const scopeCheck = await client.query(
        `SELECT capture_lead_id FROM platform.lead_capture_leads
          WHERE tenant_id = $1::uuid AND organization_id = $2::uuid
            AND capture_lead_id = ANY($3::uuid[])`,
        [context.tenantId, context.organizationId, ids],
      );
      const validIds = new Set(scopeCheck.rows.map((r: { capture_lead_id: string }) => r.capture_lead_id as string));
      const outOfScope = ids.filter((id) => !validIds.has(id));

      const taskIds: string[] = [];
      for (const captureLeadId of ids) {
        if (!validIds.has(captureLeadId)) continue;
        const ins = await client.query(
          `INSERT INTO platform.lead_tasks
             (tenant_id, organization_id, capture_lead_id, title, description,
              assignee_subject_id, due_at, priority, created_by_subject_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9)
           RETURNING task_id`,
          [context.tenantId, context.organizationId, captureLeadId, title, description, assignee, dueAt, priority, context.subjectId],
        );
        taskIds.push(ins.rows[0].task_id as string);
      }

      return NextResponse.json({
        success: true,
        created: taskIds.length,
        outOfScope: outOfScope.length,
        taskIds,
      }, { status: 201 });
    });
  } catch (error) {
    console.error('Bulk task creation failed:', error);
    return NextResponse.json({ error: 'Unable to create tasks.' }, { status: 500 });
  }
}

/**
 * PATCH — bulk status update across multiple tasks.
 * Body: { taskIds: string[], status: 'OPEN' | 'DONE' | 'CANCELLED' }
 */
export async function PATCH(request: Request) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    const body = await request.json().catch(() => ({}));

    const ids: string[] = Array.isArray(body.taskIds)
      ? (body.taskIds as unknown[]).filter((id): id is string => typeof id === 'string' && UUID.test(id))
      : [];
    if (ids.length === 0) return NextResponse.json({ error: 'taskIds must be a non-empty array of valid UUIDs.' }, { status: 400 });
    if (ids.length > MAX_BULK) return NextResponse.json({ error: `Bulk update is limited to ${MAX_BULK} tasks per request.` }, { status: 400 });

    const status = typeof body.status === 'string' ? body.status.trim().toUpperCase() : '';
    if (status !== 'DONE' && status !== 'CANCELLED' && status !== 'OPEN') {
      return NextResponse.json({ error: "status must be 'OPEN', 'DONE', or 'CANCELLED'." }, { status: 400 });
    }

    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId!)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }
      const result = await client.query(
        `UPDATE platform.lead_tasks
            SET status = $4,
                completed_at = CASE WHEN $4 = 'DONE' THEN now() ELSE NULL END,
                updated_at = now()
          WHERE tenant_id = $1::uuid AND organization_id = $2::uuid
            AND task_id = ANY($3::uuid[])
          RETURNING task_id`,
        [context.tenantId, context.organizationId, ids, status],
      );
      return NextResponse.json({ success: true, updated: result.rowCount ?? 0 });
    });
  } catch (error) {
    console.error('Bulk task update failed:', error);
    return NextResponse.json({ error: 'Unable to update tasks.' }, { status: 500 });
  }
}
