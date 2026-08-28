import type { PoolClient } from 'pg';
import type {
  WorkflowParticipantAssignment,
  WorkflowParticipantAssignmentProvider,
  WorkflowParticipantTargetKind,
} from '@expadio/workflow';

/**
 * Participant-assignment persistence + provider for the workflow runtime.
 *
 * A stage names semantic participant slots (e.g. "reviewer"); entering the stage
 * is gated until each slot is filled. This reads/writes the tenant-scoped
 * workflow_participant_assignments table. The caller must pass a client already
 * bound to the tenant RLS context.
 */

export interface AssignmentSummary {
  readonly stageKey: string;
  readonly participantKey: string;
  readonly targetKind: string;
  readonly targetKey: string;
  readonly status: string;
}

export class PostgresParticipantAssignmentProvider implements WorkflowParticipantAssignmentProvider {
  readonly #client: PoolClient;
  constructor(client: PoolClient) {
    this.#client = client;
  }

  async resolve(input: {
    readonly context: { readonly tenantId: string; readonly instanceId: string; readonly workTypeKey: string; readonly stageKey: string };
    readonly participantKeys: readonly string[];
  }): Promise<readonly WorkflowParticipantAssignment[]> {
    if (input.participantKeys.length === 0) return [];
    const result = await this.#client.query(
      `SELECT participant_key, target_kind, target_key, status, assignment_id
         FROM platform.workflow_participant_assignments
        WHERE tenant_id = $1::uuid AND instance_id = $2::uuid AND stage_key = $3
          AND participant_key = ANY($4::text[])`,
      [input.context.tenantId, input.context.instanceId, input.context.stageKey, [...input.participantKeys]],
    );
    return result.rows.map((row): WorkflowParticipantAssignment => ({
      participantKey: row.participant_key,
      status: row.status,
      assignmentId: row.assignment_id,
      target: { kind: row.target_kind as WorkflowParticipantTargetKind, key: row.target_key },
      code: row.status === 'ASSIGNED' ? 'WORKFLOW_PARTICIPANT_ASSIGNED' : `WORKFLOW_PARTICIPANT_${row.status}`,
      evidenceRefs: [],
    }));
  }
}

export type AssignParticipantResult = { readonly ok: true; readonly status: string } | { readonly ok: false; readonly reason: 'BAD_STAGE' };

/** Assign (or re-assign) a participant slot for an instance's stage. */
export async function assignParticipant(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly instanceId: string;
    readonly stageKey: string;
    readonly participantKey: string;
    readonly targetKind: string;
    readonly targetKey: string;
    readonly assignedBySubjectId: string;
  },
): Promise<AssignParticipantResult> {
  const result = await client.query(
    `INSERT INTO platform.workflow_participant_assignments
       (tenant_id, instance_id, stage_key, participant_key, target_kind, target_key, status, assigned_by_subject_id)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, 'ASSIGNED', $7)
     ON CONFLICT (tenant_id, instance_id, stage_key, participant_key)
       DO UPDATE SET target_kind = EXCLUDED.target_kind, target_key = EXCLUDED.target_key,
                     status = 'ASSIGNED', assigned_by_subject_id = EXCLUDED.assigned_by_subject_id,
                     updated_at = now()
     RETURNING status`,
    [input.tenantId, input.instanceId, input.stageKey, input.participantKey, input.targetKind, input.targetKey, input.assignedBySubjectId],
  );
  return { ok: true, status: result.rows[0].status };
}

/** All participant assignments recorded for an instance, for display. */
export async function listAssignments(
  client: PoolClient,
  input: { readonly tenantId: string; readonly instanceId: string },
): Promise<AssignmentSummary[]> {
  const result = await client.query(
    `SELECT stage_key, participant_key, target_kind, target_key, status
       FROM platform.workflow_participant_assignments
      WHERE tenant_id = $1::uuid AND instance_id = $2::uuid
      ORDER BY stage_key, participant_key`,
    [input.tenantId, input.instanceId],
  );
  return result.rows.map((row): AssignmentSummary => ({
    stageKey: row.stage_key,
    participantKey: row.participant_key,
    targetKind: row.target_kind,
    targetKey: row.target_key,
    status: row.status,
  }));
}
