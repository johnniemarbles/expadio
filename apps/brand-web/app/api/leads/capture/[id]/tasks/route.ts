import { NextResponse } from 'next/server';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function taskRow(row: Record<string, unknown>) {
  return {
    taskId: row.task_id,
    title: row.title,
    description: row.description,
    assigneeSubjectId: row.assignee_subject_id,
    dueAt: row.due_at ? new Date(row.due_at as string).toISOString() : null,
    status: row.status,
    completedAt: row.completed_at ? new Date(row.completed_at as string).toISOString() : null,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    const captureLeadId = (await params).id.trim();
    if (!UUID.test(captureLeadId)) return NextResponse.json({ error: 'A valid capture lead id is required.' }, { status: 400 });
    return await withBrandTransaction(context, async (client) => {
      const result = await client.query(
        `SELECT task_id, title, description, assignee_subject_id, due_at, status, completed_at, created_at
           FROM platform.lead_tasks
          WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND capture_lead_id = $3::uuid
          ORDER BY (status = 'OPEN') DESC, due_at NULLS LAST, created_at DESC
          LIMIT 200`,
        [context.tenantId, context.organizationId, captureLeadId],
      );
      return NextResponse.json({ tasks: result.rows.map(taskRow) });
    });
  } catch (error) {
    console.error('Lead task read failed:', error);
    return NextResponse.json({ error: 'Unable to load tasks.' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    const captureLeadId = (await params).id.trim();
    if (!UUID.test(captureLeadId)) return NextResponse.json({ error: 'A valid capture lead id is required.' }, { status: 400 });
    const body = await request.json().catch(() => ({}));
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > 200) return NextResponse.json({ error: 'A task title (1-200 chars) is required.' }, { status: 400 });
    const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim().slice(0, 5000) : null;
    const assignee = typeof body.assigneeSubjectId === 'string' && body.assigneeSubjectId.trim() ? body.assigneeSubjectId.trim() : null;
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
      const lead = await client.query(
        `SELECT 1 FROM platform.lead_capture_leads WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND capture_lead_id = $3::uuid`,
        [context.tenantId, context.organizationId, captureLeadId],
      );
      if (lead.rowCount === 0) return NextResponse.json({ error: 'Capture lead not found.' }, { status: 404 });
      const inserted = await client.query(
        `INSERT INTO platform.lead_tasks
           (tenant_id, organization_id, capture_lead_id, title, description, assignee_subject_id, due_at, created_by_subject_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8)
         RETURNING task_id, title, description, assignee_subject_id, due_at, status, completed_at, created_at`,
        [context.tenantId, context.organizationId, captureLeadId, title, description, assignee, dueAt, context.subjectId],
      );
      return NextResponse.json({ success: true, task: taskRow(inserted.rows[0]) }, { status: 201 });
    });
  } catch (error) {
    console.error('Lead task creation failed:', error);
    return NextResponse.json({ error: 'Unable to create the task.' }, { status: 500 });
  }
}
