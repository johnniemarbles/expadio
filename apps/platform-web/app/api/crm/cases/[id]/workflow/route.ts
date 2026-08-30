import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../../../lib/crm-authz';
import { startWorkflow, transitionWorkflow, describeWorkflow } from '../../../../../../lib/workflow-runtime';
import type { WorkflowIndustryPackProvenance } from '@expadio/workflow';
import { appendCrmCaseLifecycleEvent } from '../../../../../../lib/crm-case-lifecycle-event';

/**
 * Bind a CRM case to the Decision Fabric.
 *
 *  GET   — the case's workflow instance (if started) and the blueprint's stages.
 *  POST  — start a governed workflow for the case against its blueprint_key.
 *  PATCH — advance the case's instance to a target stage (append-only history).
 *
 * Reads require membership; writes require a governing role. The case's
 * stage_key mirrors the instance's current stage so the CRM surface and the
 * governed workflow never drift.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUBJECT_TYPE = 'crm.case';

function requestCorrelationId(request: Request): string {
  const supplied = request.headers.get('x-correlation-id')?.trim() ?? '';
  if (
    supplied !== ''
    && supplied.length <= 200
    && !/[\r\n\t]/u.test(supplied)
  ) {
    return supplied;
  }
  return crypto.randomUUID();
}

function workflowPackProvenanceFromRow(row: any): WorkflowIndustryPackProvenance | undefined {
  const source = row.industry_pack_runtime_source as
    | 'TENANT_PUBLISHED'
    | 'PLATFORM_PUBLISHED'
    | 'CODE_BASELINE'
    | 'NEUTRAL'
    | null
    | undefined;
  if (source == null) return undefined;
  if (source === 'NEUTRAL') return { runtimeSource: 'NEUTRAL' };

  const verticalKey = String(row.industry_pack_vertical_key ?? '').trim();
  if (verticalKey === '') {
    throw new Error('CRM_CASE_INDUSTRY_PACK_PROVENANCE_VERTICAL_KEY_MISSING');
  }
  if (source === 'CODE_BASELINE') {
    const version = row.industry_pack_version == null ? undefined : Number(row.industry_pack_version);
    return {
      runtimeSource: source,
      verticalKey,
      ...(version === undefined ? {} : { version }),
    };
  }

  const version = Number(row.industry_pack_version);
  if (!Number.isInteger(version) || version <= 0) {
    throw new Error('CRM_CASE_INDUSTRY_PACK_PROVENANCE_VERSION_INVALID');
  }
  return { runtimeSource: source, verticalKey, version };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const caseId = decodeURIComponent((await params).id);

    const result = await withTenantClient(context, async (client) => {
      const row = await client.query(
        `SELECT workflow_instance_id, blueprint_key, stage_key FROM platform.crm_cases WHERE case_id = $1::uuid`,
        [caseId],
      );
      if (row.rows.length === 0) return { notFound: true } as const;
      const instanceId = row.rows[0].workflow_instance_id as string | null;
      const blueprintKey = row.rows[0].blueprint_key as string | null;
      if (instanceId === null) return { instance: null, blueprintKey } as const;
      const described = await describeWorkflow(client, { tenantId: context.tenantId, instanceId });
      return { described, blueprintKey } as const;
    });

    if ('notFound' in result) {
      return NextResponse.json({ error: 'That case was not found in this workspace.' }, { status: 404 });
    }
    if ('instance' in result) {
      return NextResponse.json({ instance: null, blueprintKey: result.blueprintKey });
    }
    if (result.described === null) {
      return NextResponse.json({ instance: null, blueprintKey: result.blueprintKey });
    }
    return NextResponse.json({
      instance: result.described.instance,
      stages: result.described.stages,
      currentDecision: result.described.currentDecision,
      assignments: result.described.assignments,
      blueprintKey: result.blueprintKey,
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const caseId = decodeURIComponent((await params).id);

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasCrmWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      await client.query('BEGIN');
      try {
        await context.applyTo(client);
        const row = await client.query(
          `SELECT blueprint_key, workflow_instance_id,
                  industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source
             FROM platform.crm_cases
            WHERE case_id = $1::uuid
            FOR UPDATE`,
          [caseId],
        );
        if (row.rows.length === 0) {
          await client.query('ROLLBACK');
          return { notFound: true } as const;
        }
        const blueprintKey = row.rows[0].blueprint_key as string | null;
        if (row.rows[0].workflow_instance_id !== null) {
          await client.query('ROLLBACK');
          return { already: true } as const;
        }
        if (blueprintKey === null || blueprintKey.trim() === '') {
          await client.query('ROLLBACK');
          return { noBlueprintKey: true } as const;
        }

        const started = await startWorkflow(client, {
          tenantId: context.tenantId,
          subjectType: SUBJECT_TYPE,
          subjectId: caseId,
          blueprintKey,
          industryPackProvenance: workflowPackProvenanceFromRow(row.rows[0]),
        });
        if (!started.ok) {
          await client.query('ROLLBACK');
          return { noBlueprint: true } as const;
        }

        await client.query(
          `UPDATE platform.crm_cases
              SET workflow_instance_id = $2::uuid, stage_key = $3, updated_at = now()
            WHERE case_id = $1::uuid`,
          [caseId, started.instance.instanceId, started.instance.currentStageKey ?? null],
        );
        await client.query('COMMIT');
        return { instance: started.instance, stages: started.stages } as const;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to start a workflow.' }, { status: 403 });
    }
    if ('notFound' in result) {
      return NextResponse.json({ error: 'That case was not found in this workspace.' }, { status: 404 });
    }
    if ('already' in result) {
      return NextResponse.json({ error: 'This case already has a workflow.' }, { status: 409 });
    }
    if ('noBlueprintKey' in result) {
      return NextResponse.json({ error: 'Set a workflow blueprint on the case first.' }, { status: 400 });
    }
    if ('noBlueprint' in result) {
      return NextResponse.json({ error: 'No active workflow blueprint matches that key.' }, { status: 400 });
    }
    return NextResponse.json({ success: true, instance: result.instance, stages: result.stages }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const caseId = decodeURIComponent((await params).id);
    const body = await request.json();
    const toStageKey = typeof body?.toStageKey === 'string' ? body.toStageKey.trim() : '';
    const expectedRevision = Number(body?.expectedRevision);
    const reason = typeof body?.reason === 'string' && body.reason.trim() !== '' ? body.reason.trim() : undefined;
    const correlationId = requestCorrelationId(request);
    if (toStageKey === '') {
      return NextResponse.json({ error: 'A target stage is required.' }, { status: 400 });
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      return NextResponse.json({ error: 'A valid expected revision is required.' }, { status: 400 });
    }

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasCrmWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      await client.query('BEGIN');
      try {
        await context.applyTo(client);
        const row = await client.query(
          `SELECT workflow_instance_id, stage_key,
                  industry_pack_vertical_key, industry_pack_version,
                  industry_pack_runtime_source
             FROM platform.crm_cases
            WHERE case_id = $1::uuid
            FOR UPDATE`,
          [caseId],
        );
        if (row.rows.length === 0) {
          await client.query('ROLLBACK');
          return { notFound: true } as const;
        }
        const caseRow = row.rows[0];
        const instanceId = caseRow.workflow_instance_id as string | null;
        if (instanceId === null) {
          await client.query('ROLLBACK');
          return { noWorkflow: true } as const;
        }

        const moved = await transitionWorkflow(client, {
          tenantId: context.tenantId,
          instanceId,
          expectedRevision,
          toStageKey,
          requestedBySubjectId: context.subjectId,
          reason,
        });
        if (!moved.ok) {
          await client.query('ROLLBACK');
          if (moved.reason === 'TRANSITION_REJECTED') {
            return { rejected: true, message: moved.message, code: moved.code } as const;
          }
          if (moved.reason === 'GATE_BLOCKED') {
            return { gateBlocked: true, blockers: moved.blockers } as const;
          }
          return { failed: moved.reason } as const;
        }

        await client.query(
          `UPDATE platform.crm_cases SET stage_key = $2, updated_at = now() WHERE case_id = $1::uuid`,
          [caseId, moved.instance.currentStageKey ?? null],
        );

        const lifecycleEvent = await appendCrmCaseLifecycleEvent(client, {
          tenantId: context.tenantId,
          caseId,
          workflowInstanceId: instanceId,
          fromStageKey: caseRow.stage_key ?? null,
          toStageKey: moved.instance.currentStageKey ?? toStageKey,
          actorSubjectId: context.subjectId,
          correlationId,
          provenance: {
            verticalKey: caseRow.industry_pack_vertical_key ?? null,
            version: caseRow.industry_pack_version ?? null,
            runtimeSource: caseRow.industry_pack_runtime_source ?? null,
          },
          ...(reason === undefined ? {} : { reason }),
        });

        await client.query('COMMIT');
        return {
          instance: moved.instance,
          stages: moved.stages,
          domainEventId: lifecycleEvent?.event.eventId ?? null,
        } as const;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to advance a workflow.' }, { status: 403 });
    }
    if ('notFound' in result) {
      return NextResponse.json({ error: 'That case was not found in this workspace.' }, { status: 404 });
    }
    if ('noWorkflow' in result) {
      return NextResponse.json({ error: 'Start a workflow for this case first.' }, { status: 409 });
    }
    if ('rejected' in result) {
      return NextResponse.json({ error: result.message, code: result.code }, { status: 422 });
    }
    if ('gateBlocked' in result) {
      const blockers = result.blockers ?? [];
      const condition = blockers.find((b) => b.kind === 'ENTRY_CONDITION' || b.kind === 'EXIT_CONDITION');
      const participant = blockers.find((b) => b.kind === 'PARTICIPANT' || b.kind === 'ASSIGNMENT');
      const needsDecision = blockers.some((b) => b.code === 'WORKFLOW_DECISION_REQUIRED');
      const conditionMessages: Record<string, string> = {
        CASE_ACCOUNT_MISSING: 'Link the case to an account before it can be resolved.',
        CASE_DESCRIPTION_MISSING: 'Add a description to the case before it can leave this stage.',
        WORKFLOW_CONDITION_UNKNOWN: 'A blueprint condition on this stage could not be evaluated.',
      };
      const error = condition
        ? (condition.message ?? conditionMessages[condition.code] ?? `A "${condition.key ?? 'stage'}" condition is not met.`)
        : participant
          ? `This stage needs its "${participant.key ?? 'required'}" participant assigned before it can be entered.`
          : needsDecision
            ? 'This stage requires a recorded decision before it can advance.'
            : 'A workflow gate is blocking this transition.';
      return NextResponse.json({ error, code: blockers[0]?.code, blockers }, { status: 422 });
    }
    if ('failed' in result) {
      if (result.failed === 'REVISION_CONFLICT') {
        return NextResponse.json({ error: 'The workflow moved since you loaded it. Refresh and try again.' }, { status: 409 });
      }
      return NextResponse.json({ error: 'That workflow instance was not found.' }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      instance: result.instance,
      stages: result.stages,
      domainEventId: result.domainEventId,
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
