import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../../../lib/crm-authz';
import { assignParticipant } from '../../../../../../lib/workflow-participants';

/**
 * Assign a participant to a vendor stage's semantic slot (e.g. "screener" on
 * SCREENING). Entering a stage is gated until its required slots are filled.
 * Governed by a tenant role; the assignment is tenant-scoped by RLS. When no
 * explicit target is given, the caller is assigned as a USER.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TARGET_KINDS = new Set([
  'USER', 'ROLE', 'PERSONA', 'TEAM', 'QUEUE', 'ORGANIZATION', 'TERRITORY', 'EXTERNAL_PARTY', 'SYSTEM', 'AI_AGENT',
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveRequestContext(request);
    const vendorId = decodeURIComponent((await params).id);
    const body = await request.json();

    const stageKey = typeof body?.stageKey === 'string' ? body.stageKey.trim() : '';
    const participantKey = typeof body?.participantKey === 'string' ? body.participantKey.trim() : '';
    if (stageKey === '' || participantKey === '') {
      return NextResponse.json({ error: 'A stage and participant slot are required.' }, { status: 400 });
    }
    const targetKind = typeof body?.targetKind === 'string' && TARGET_KINDS.has(body.targetKind) ? body.targetKind : 'USER';
    const targetKey = typeof body?.targetKey === 'string' && body.targetKey.trim() !== '' ? body.targetKey.trim() : context.subjectId;

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasCrmWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      const row = await client.query(
        `SELECT workflow_instance_id FROM platform.vendors WHERE vendor_id = $1::uuid`,
        [vendorId],
      );
      if (row.rows.length === 0) return { notFound: true } as const;
      const instanceId = row.rows[0].workflow_instance_id as string | null;
      if (instanceId === null) return { noWorkflow: true } as const;

      const assigned = await assignParticipant(client, {
        tenantId: context.tenantId,
        instanceId,
        stageKey,
        participantKey,
        targetKind,
        targetKey,
        assignedBySubjectId: context.subjectId,
      });
      return { assigned, stageKey, participantKey, targetKind, targetKey } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to assign participants.' }, { status: 403 });
    }
    if ('notFound' in result) {
      return NextResponse.json({ error: 'That vendor was not found in this workspace.' }, { status: 404 });
    }
    if ('noWorkflow' in result) {
      return NextResponse.json({ error: 'Start a workflow for this vendor first.' }, { status: 409 });
    }
    return NextResponse.json({
      success: true,
      stageKey: result.stageKey,
      participantKey: result.participantKey,
      targetKind: result.targetKind,
      targetKey: result.targetKey,
      status: result.assigned.ok ? result.assigned.status : 'ASSIGNED',
    }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
