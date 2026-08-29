import { NextResponse } from 'next/server';
import { PostgresWorkflowInstanceRepository } from '@expadio/postgres-runtime/workflow-instance';
import { resolveRequestContext, withTenantClient, deniedResponse } from './request-context';
import { hasGovernanceWriteRole } from './governance-authz';
import {
  startWorkflow,
  transitionWorkflow,
  describeWorkflow,
  recordCaseDecision,
  makerForStage,
  loadCaseWorkflowHistory,
} from './workflow-runtime';
import { assignParticipant } from './workflow-participants';

/**
 * The governed workflow route, shared by every non-CRM vertical.
 *
 * Binding a subject to the Decision Fabric is identical across verticals — start
 * the blueprint's workflow, mirror the instance's current stage onto the subject
 * row, advance it through the same gates, keep an append-only history. The only
 * things that differ are which table the subject lives in, its id column, the
 * subject_type, the business status derived from the stage, and the nouns in the
 * messages. This factory captures the orchestration once; each vertical's route
 * is just its config, so a fifth vertical is a dozen lines, not another 226.
 *
 *   GET   — the subject's workflow instance (if started) and the blueprint's stages.
 *   POST  — start the vertical's workflow for the subject.
 *   PATCH — advance the subject's instance to a target stage (append-only history).
 *
 * Reads require membership; writes require a governing role. `table`/`idColumn`
 * are internal constants (never request input), so interpolating them into the
 * SQL is safe; every subject id and value is still parameterized.
 */
export interface VerticalWorkflowConfig {
  /** Fully-qualified subject table, e.g. 'platform.vendors'. */
  readonly table: string;
  /** The subject table's uuid primary key column, e.g. 'vendor_id'. */
  readonly idColumn: string;
  /** The subject_type recorded on the workflow instance, e.g. 'vendor'. */
  readonly subjectType: string;
  /** The user-facing noun for messages, e.g. 'vendor' or 'access request'. */
  readonly subjectNoun: string;
  /** The blueprint/work-type label named in the no-blueprint message, e.g. 'vendor.onboarding'. */
  readonly blueprintLabel: string;
  /** Business status derived from the workflow stage the subject sits at. */
  readonly statusForStage: (stageKey: string | null) => string;
}

export function createVerticalWorkflowRoute(config: VerticalWorkflowConfig) {
  const { table, idColumn, subjectType, subjectNoun, blueprintLabel, statusForStage } = config;
  const notFound = `That ${subjectNoun} was not found in this workspace.`;

  async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      const context = await resolveRequestContext(request);
      const subjectId = decodeURIComponent((await params).id);

      const result = await withTenantClient(context, async (client) => {
        const row = await client.query(
          `SELECT workflow_instance_id, blueprint_key, stage_key FROM ${table} WHERE ${idColumn} = $1::uuid`,
          [subjectId],
        );
        if (row.rows.length === 0) return { notFound: true } as const;
        const instanceId = row.rows[0].workflow_instance_id as string | null;
        const blueprintKey = row.rows[0].blueprint_key as string | null;
        if (instanceId === null) return { instance: null, blueprintKey } as const;
        const described = await describeWorkflow(client, { tenantId: context.tenantId, instanceId });
        return { described, blueprintKey } as const;
      });

      if ('notFound' in result) {
        return NextResponse.json({ error: notFound }, { status: 404 });
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

  async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      const context = await resolveRequestContext(request);
      const subjectId = decodeURIComponent((await params).id);

      const result = await withTenantClient(context, async (client) => {
        if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
          return { forbidden: true } as const;
        }
        await client.query('BEGIN');
        try {
          await context.applyTo(client);
          const row = await client.query(
            `SELECT blueprint_key, workflow_instance_id FROM ${table} WHERE ${idColumn} = $1::uuid FOR UPDATE`,
            [subjectId],
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
            subjectType,
            subjectId,
            blueprintKey,
          });
          if (!started.ok) {
            await client.query('ROLLBACK');
            return { noBlueprint: true } as const;
          }

          await client.query(
            `UPDATE ${table}
                SET workflow_instance_id = $2::uuid, stage_key = $3, status = $4, updated_at = now()
              WHERE ${idColumn} = $1::uuid`,
            [subjectId, started.instance.instanceId, started.instance.currentStageKey ?? null, statusForStage(started.instance.currentStageKey ?? null)],
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
        return NextResponse.json({ error: notFound }, { status: 404 });
      }
      if ('already' in result) {
        return NextResponse.json({ error: `This ${subjectNoun} already has a workflow.` }, { status: 409 });
      }
      if ('noBlueprintKey' in result || 'noBlueprint' in result) {
        return NextResponse.json({ error: `No active ${blueprintLabel} blueprint is available.` }, { status: 409 });
      }
      return NextResponse.json({ success: true, instance: result.instance, stages: result.stages }, { status: 201 });
    } catch (error) {
      const { body, status } = deniedResponse(error);
      return NextResponse.json(body, { status });
    }
  }

  async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      const context = await resolveRequestContext(request);
      const subjectId = decodeURIComponent((await params).id);
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
        if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
          return { forbidden: true } as const;
        }
        await client.query('BEGIN');
        try {
          await context.applyTo(client);
          const row = await client.query(
            `SELECT workflow_instance_id FROM ${table} WHERE ${idColumn} = $1::uuid FOR UPDATE`,
            [subjectId],
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
            `UPDATE ${table} SET stage_key = $2, status = $3, updated_at = now() WHERE ${idColumn} = $1::uuid`,
            [subjectId, moved.instance.currentStageKey ?? null, statusForStage(moved.instance.currentStageKey ?? null)],
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
        return NextResponse.json({ error: notFound }, { status: 404 });
      }
      if ('noWorkflow' in result) {
        return NextResponse.json({ error: `Start a workflow for this ${subjectNoun} first.` }, { status: 409 });
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

  return { GET, POST, PATCH };
}

/** Config a governed sub-route needs: which table/id the subject lives in, and its noun. */
type SubjectBinding = Pick<VerticalWorkflowConfig, 'table' | 'idColumn' | 'subjectNoun'>;

/**
 * Record an immutable decision against the subject's current workflow stage —
 * the same governed capture as a CRM case. Work type and stage come from the
 * instance, so authority derivation and separation of duties apply per the
 * vertical's own registration; role gates the write.
 */
export function createVerticalDecisionRoute({ table, idColumn, subjectNoun }: SubjectBinding) {
  const notFound = `That ${subjectNoun} was not found in this workspace.`;
  const noWorkflow = `Start a workflow for this ${subjectNoun} first.`;

  async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      const context = await resolveRequestContext(request);
      const subjectId = decodeURIComponent((await params).id);
      const body = await request.json();
      const outcome = typeof body?.outcome === 'string' ? body.outcome.trim() : '';
      if (outcome === '') {
        return NextResponse.json({ error: 'A decision outcome is required.' }, { status: 400 });
      }

      const result = await withTenantClient(context, async (client) => {
        if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
          return { forbidden: true } as const;
        }
        const row = await client.query(
          `SELECT workflow_instance_id FROM ${table} WHERE ${idColumn} = $1::uuid`,
          [subjectId],
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
        return NextResponse.json({ error: notFound }, { status: 404 });
      }
      if ('noWorkflow' in result || 'noStage' in result) {
        return NextResponse.json({ error: noWorkflow }, { status: 409 });
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

  return { POST };
}

/**
 * The governed trace for a subject's workflow: its append-only stage transitions
 * and immutable decisions, one chronological timeline. A membership read; RLS
 * keeps it within the caller's tenant.
 */
export function createVerticalHistoryRoute({ table, idColumn, subjectNoun }: SubjectBinding) {
  const notFound = `That ${subjectNoun} was not found in this workspace.`;

  async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      const context = await resolveRequestContext(request);
      const subjectId = decodeURIComponent((await params).id);

      const result = await withTenantClient(context, async (client) => {
        const row = await client.query(
          `SELECT workflow_instance_id FROM ${table} WHERE ${idColumn} = $1::uuid`,
          [subjectId],
        );
        if (row.rows.length === 0) return { notFound: true } as const;
        const instanceId = row.rows[0].workflow_instance_id as string | null;
        if (instanceId === null) return { entries: [] } as const;
        const entries = await loadCaseWorkflowHistory(client, { tenantId: context.tenantId, instanceId });
        return { entries } as const;
      });

      if ('notFound' in result) {
        return NextResponse.json({ error: notFound }, { status: 404 });
      }
      return NextResponse.json({ entries: result.entries });
    } catch (error) {
      const { body, status } = deniedResponse(error);
      return NextResponse.json(body, { status });
    }
  }

  return { GET };
}

const PARTICIPANT_TARGET_KINDS = new Set([
  'USER', 'ROLE', 'PERSONA', 'TEAM', 'QUEUE', 'ORGANIZATION', 'TERRITORY', 'EXTERNAL_PARTY', 'SYSTEM', 'AI_AGENT',
]);

/**
 * Assign a participant to a subject stage's semantic slot. Entering a stage is
 * gated until its required slots are filled. Governed by a tenant role; the
 * assignment is tenant-scoped by RLS. With no explicit target, the caller is
 * assigned as a USER.
 */
export function createVerticalParticipantsRoute({ table, idColumn, subjectNoun }: SubjectBinding) {
  const notFound = `That ${subjectNoun} was not found in this workspace.`;
  const noWorkflow = `Start a workflow for this ${subjectNoun} first.`;

  async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      const context = await resolveRequestContext(request);
      const subjectId = decodeURIComponent((await params).id);
      const body = await request.json();

      const stageKey = typeof body?.stageKey === 'string' ? body.stageKey.trim() : '';
      const participantKey = typeof body?.participantKey === 'string' ? body.participantKey.trim() : '';
      if (stageKey === '' || participantKey === '') {
        return NextResponse.json({ error: 'A stage and participant slot are required.' }, { status: 400 });
      }
      const targetKind = typeof body?.targetKind === 'string' && PARTICIPANT_TARGET_KINDS.has(body.targetKind) ? body.targetKind : 'USER';
      const targetKey = typeof body?.targetKey === 'string' && body.targetKey.trim() !== '' ? body.targetKey.trim() : context.subjectId;

      const result = await withTenantClient(context, async (client) => {
        if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
          return { forbidden: true } as const;
        }
        const row = await client.query(
          `SELECT workflow_instance_id FROM ${table} WHERE ${idColumn} = $1::uuid`,
          [subjectId],
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
        return NextResponse.json({ error: notFound }, { status: 404 });
      }
      if ('noWorkflow' in result) {
        return NextResponse.json({ error: noWorkflow }, { status: 409 });
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

  return { POST };
}
