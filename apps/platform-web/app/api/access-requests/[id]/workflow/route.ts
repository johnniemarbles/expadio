import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../../lib/crm-authz';
import { startWorkflow, transitionWorkflow, describeWorkflow } from '../../../../../lib/workflow-runtime';

/**
 * Bind an access request to the Decision Fabric — the same generic runtime that
 * governs cases, vendors and expenses, on a fourth subject type.
 *
 *  GET   — the request's workflow instance (if started) and the blueprint's stages.
 *  POST  — start the access.request workflow for the request.
 *  PATCH — advance the request's instance to a target stage (append-only history).
 *
 * Reads require membership; writes require a governing role. The request's
 * stage_key mirrors the instance's current stage, and its status flips to GRANTED
 * once it reaches the final stage.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUBJECT_TYPE = 'access.request';

function statusForStage(stageKey: string | null): string {
  return stageKey === 'GRANTED' ? 'GRANTED' : 'SUBMITTED';
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveRequestContext(request);
    const id = decodeURIComponent((await params).id);

    const result = await withTenantClient(context, async (client) => {
      const row = await client.query(
        `SELECT workflow_instance_id, blueprint_key, stage_key FROM platform.access_requests WHERE access_request_id = $1::uuid`,
        [id],
      );
      if (row.rows.length === 0) return { notFound: true } as const;
      const instanceId = row.rows[0].workflow_instance_id as string | null;
      const blueprintKey = row.rows[0].blueprint_key as string | null;
      if (instanceId === null) return { instance: null, blueprintKey } as const;
      const described = await describeWorkflow(client, { tenantId: context.tenantId, instanceId });
      return { described, blueprintKey } as const;
    });

    if ('notFound' in result) {
      return NextResponse.json({ error: 'That access request was not found in this workspace.' }, { status: 404 });
    }
    if ('instance' in result || result.described === null) {
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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveRequestContext(request);
    const id = decodeURIComponent((await params).id);

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasCrmWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      await client.query('BEGIN');
      try {
        await context.applyTo(client);
        const row = await client.query(
          `SELECT blueprint_key, workflow_instance_id FROM platform.access_requests WHERE access_request_id = $1::uuid FOR UPDATE`,
          [id],
        );
        if (row.rows.length === 0) {
          await client.query('ROLLBACK');
          return { notFound: true } as const;
        }
        if (row.rows[0].workflow_instance_id !== null) {
          await client.query('ROLLBACK');
          return { already: true } as const;
        }
        const blueprintKey = row.rows[0].blueprint_key as string | null;
        if (blueprintKey === null || blueprintKey.trim() === '') {
          await client.query('ROLLBACK');
          return { noBlueprintKey: true } as const;
        }

        const started = await startWorkflow(client, {
          tenantId: context.tenantId,
          subjectType: SUBJECT_TYPE,
          subjectId: id,
          blueprintKey,
        });
        if (!started.ok) {
          await client.query('ROLLBACK');
          return { noBlueprint: true } as const;
        }

        await client.query(
          `UPDATE platform.access_requests
              SET workflow_instance_id = $2::uuid, stage_key = $3, status = $4, updated_at = now()
            WHERE access_request_id = $1::uuid`,
          [id, started.instance.instanceId, started.instance.currentStageKey ?? null, statusForStage(started.instance.currentStageKey ?? null)],
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
      return NextResponse.json({ error: 'That access request was not found in this workspace.' }, { status: 404 });
    }
    if ('already' in result) {
      return NextResponse.json({ error: 'This access request already has a workflow.' }, { status: 409 });
    }
    if ('noBlueprintKey' in result || 'noBlueprint' in result) {
      return NextResponse.json({ error: 'No active access.request blueprint is available.' }, { status: 409 });
    }
    return NextResponse.json({ success: true, instance: result.instance, stages: result.stages }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveRequestContext(request);
    const id = decodeURIComponent((await params).id);
    const body = await request.json();
    const toStageKey = typeof body?.toStageKey === 'string' ? body.toStageKey.trim() : '';
    const expectedRevision = Number(body?.expectedRevision);
    const reason = typeof body?.reason === 'string' && body.reason.trim() !== '' ? body.reason.trim() : undefined;
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
          `SELECT workflow_instance_id FROM platform.access_requests WHERE access_request_id = $1::uuid FOR UPDATE`,
          [id],
        );
        if (row.rows.length === 0) {
          await client.query('ROLLBACK');
          return { notFound: true } as const;
        }
        const instanceId = row.rows[0].workflow_instance_id as string | null;
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
          if (moved.reason === 'TRANSITION_REJECTED') return { rejected: true, message: moved.message, code: moved.code } as const;
          if (moved.reason === 'GATE_BLOCKED') return { gateBlocked: true, blockers: moved.blockers } as const;
          return { failed: moved.reason } as const;
        }

        await client.query(
          `UPDATE platform.access_requests SET stage_key = $2, status = $3, updated_at = now() WHERE access_request_id = $1::uuid`,
          [id, moved.instance.currentStageKey ?? null, statusForStage(moved.instance.currentStageKey ?? null)],
        );
        await client.query('COMMIT');
        return { instance: moved.instance, stages: moved.stages } as const;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to advance a workflow.' }, { status: 403 });
    }
    if ('notFound' in result) {
      return NextResponse.json({ error: 'That access request was not found in this workspace.' }, { status: 404 });
    }
    if ('noWorkflow' in result) {
      return NextResponse.json({ error: 'Start a workflow for this access request first.' }, { status: 409 });
    }
    if ('rejected' in result) {
      return NextResponse.json({ error: result.message, code: result.code }, { status: 422 });
    }
    if ('gateBlocked' in result) {
      return NextResponse.json({ error: 'A gate is blocking this transition.', blockers: result.blockers }, { status: 409 });
    }
    if ('failed' in result) {
      return NextResponse.json({ error: `Transition failed: ${result.failed}.` }, { status: 409 });
    }
    return NextResponse.json({ success: true, instance: result.instance, stages: result.stages });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
