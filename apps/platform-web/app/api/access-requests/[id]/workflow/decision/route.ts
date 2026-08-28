import { NextResponse } from 'next/server';
import { PostgresWorkflowInstanceRepository } from '@expadio/postgres-runtime/workflow-instance';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../../../lib/crm-authz';
import { recordCaseDecision, makerForStage } from '../../../../../../lib/workflow-runtime';

/**
 * Record an immutable decision against an access request's current workflow
 * stage — the same governed decision capture as the other verticals. This lets
 * the decision-required SECURITY_REVIEW stage advance to GRANTED.
 *
 * access.request registers no authority deriver, so the decision is gated by
 * role and separation of duties alone: the reviewer must hold a governing role
 * and differ from the requester who moved it into SECURITY_REVIEW.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveRequestContext(request);
    const id = decodeURIComponent((await params).id);
    const body = await request.json();
    const outcome = typeof body?.outcome === 'string' ? body.outcome.trim() : '';
    if (outcome === '') {
      return NextResponse.json({ error: 'A decision outcome is required.' }, { status: 400 });
    }

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasCrmWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      const row = await client.query(
        `SELECT workflow_instance_id FROM platform.access_requests WHERE access_request_id = $1::uuid`,
        [id],
      );
      if (row.rows.length === 0) return { notFound: true } as const;
      const instanceId = row.rows[0].workflow_instance_id as string | null;
      if (instanceId === null) return { noWorkflow: true } as const;

      const instance = await new PostgresWorkflowInstanceRepository(client).findById({
        tenantId: context.tenantId,
        instanceId,
      });
      if (instance === null || instance.currentStageKey === undefined) {
        return { noStage: true } as const;
      }

      const maker = await makerForStage(client, {
        tenantId: context.tenantId,
        instanceId,
        stageKey: instance.currentStageKey,
      });
      const recorded = await recordCaseDecision(client, {
        tenantId: context.tenantId,
        instanceId,
        workTypeKey: instance.workTypeKey,
        stageKey: instance.currentStageKey,
        outcome,
        approverSubjectId: context.subjectId,
        makerSubjectId: maker,
      });
      return { recorded, stageKey: instance.currentStageKey } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to record a decision.' }, { status: 403 });
    }
    if ('notFound' in result) {
      return NextResponse.json({ error: 'That access request was not found in this workspace.' }, { status: 404 });
    }
    if ('noWorkflow' in result || 'noStage' in result) {
      return NextResponse.json({ error: 'Start a workflow for this access request first.' }, { status: 409 });
    }
    if (!result.recorded.ok) {
      if (result.recorded.reason === 'AUTHORITY_DENIED') {
        return NextResponse.json({ error: result.recorded.message, code: result.recorded.code }, { status: 403 });
      }
      return NextResponse.json(
        { error: `This stage already has a different decision recorded (${result.recorded.existingOutcome}). Decisions are immutable.` },
        { status: 409 },
      );
    }
    return NextResponse.json({
      success: true,
      status: result.recorded.status,
      stageKey: result.stageKey,
      outcome: result.recorded.outcome,
    }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
