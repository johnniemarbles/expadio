import { NextResponse } from 'next/server';
import { PostgresWorkflowInstanceRepository } from '@expadio/postgres-runtime/workflow-instance';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../../../lib/crm-authz';
import { recordCaseDecision, makerForStage } from '../../../../../../lib/workflow-runtime';

/**
 * Record an immutable decision against an expense's current workflow stage — the
 * same governed decision capture as a CRM case and a vendor. This lets the
 * decision-required MANAGER_REVIEW stage advance to PAID.
 *
 * expense.reimbursement registers an authority deriver keyed to the expense's
 * own amount, so the approver must hold a monetary.approval grant that covers it
 * (and, by separation of duties, differ from the subject who moved the expense
 * into MANAGER_REVIEW).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveRequestContext(request);
    const expenseId = decodeURIComponent((await params).id);
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
        `SELECT workflow_instance_id FROM platform.expense_reports WHERE expense_id = $1::uuid`,
        [expenseId],
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
      return NextResponse.json({ error: 'That expense was not found in this workspace.' }, { status: 404 });
    }
    if ('noWorkflow' in result || 'noStage' in result) {
      return NextResponse.json({ error: 'Start a workflow for this expense first.' }, { status: 409 });
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
