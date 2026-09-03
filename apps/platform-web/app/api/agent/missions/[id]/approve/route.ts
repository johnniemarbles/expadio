import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantTransaction } from '@/lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const { id: missionId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const approved = Boolean(body.approved);
    const approvalId = typeof body.approvalId === 'string' ? body.approvalId : null;

    if (!approvalId) {
      return NextResponse.json({ error: 'APPROVAL_ID_REQUIRED' }, { status: 400 });
    }

    await withTenantTransaction(context, async (client) => {
      const status = approved ? 'APPROVED' : 'REJECTED';
      await client.query(
        `UPDATE platform.agent_approval_requests
            SET status = $1, resolved_at = now()
          WHERE approval_id = $2 AND mission_id = $3 AND tenant_id = $4`,
        [status, approvalId, missionId, context.tenantId],
      );

      const taskStatus = approved ? 'QUEUED' : 'FAILED';
      const errorMsg = approved ? null : 'Task rejected by human approval gate';
      await client.query(
        `UPDATE platform.agent_tasks
            SET status = $1, error = $2
          WHERE mission_id = $3 AND tenant_id = $4 AND status = 'AWAITING_APPROVAL'`,
        [taskStatus, errorMsg, missionId, context.tenantId],
      );
    });

    return NextResponse.json({ ok: true, missionId, approved });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'INTERNAL_ERROR';
    return NextResponse.json({ error }, { status: 500 });
  }
}
