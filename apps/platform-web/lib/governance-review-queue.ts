import type { PoolClient } from 'pg';

/**
 * The reviewer's cross-vertical inbox: every governed instance that is waiting
 * on *this* participant to act, across all four verticals at once. Today an
 * approver has to visit each vertical's own page to find their pending work;
 * this is the single "what's waiting on me" queue.
 *
 * An item is on your queue when you are the ASSIGNED participant (as a USER) on
 * the stage an open instance currently sits at, and no decision has yet been
 * recorded for that stage — i.e. the instance has stopped on a stage that names
 * you and is waiting for your action. Oldest-waiting first, since a governance
 * queue is worked by age. Reads the same append-only, RLS-scoped tables the
 * detail views list; no new tables.
 */

export interface ReviewQueueItem {
  readonly workTypeKey: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly state: string;
  readonly currentStageKey: string;
  readonly participantKey: string;
  readonly revision: number;
  readonly waitingSince: string;
}

export async function loadReviewQueue(
  client: PoolClient,
  input: { readonly subjectId: string; readonly limit?: number },
): Promise<ReviewQueueItem[]> {
  const subjectId = input.subjectId.trim();
  if (subjectId === '') return [];
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
  const result = await client.query(
    `SELECT i.work_type_key, i.subject_type, i.subject_id, i.state,
            i.current_stage_key, i.revision, i.updated_at,
            pa.participant_key
       FROM platform.workflow_participant_assignments pa
       JOIN platform.workflow_instances i
         ON i.instance_id = pa.instance_id AND i.tenant_id = pa.tenant_id
      WHERE pa.target_kind = 'USER'
        AND pa.target_key = $1
        AND pa.status = 'ASSIGNED'
        AND pa.stage_key = i.current_stage_key
        AND i.state NOT IN ('COMPLETED','CANCELLED','FAILED')
        AND NOT EXISTS (
          SELECT 1 FROM platform.workflow_stage_decisions d
           WHERE d.instance_id = i.instance_id AND d.tenant_id = i.tenant_id
             AND d.stage_key = pa.stage_key
        )
      ORDER BY i.updated_at ASC
      LIMIT $2`,
    [subjectId, limit],
  );
  return result.rows.map((row) => ({
    workTypeKey: row.work_type_key as string,
    subjectType: row.subject_type as string,
    subjectId: row.subject_id as string,
    state: row.state as string,
    currentStageKey: row.current_stage_key as string,
    participantKey: row.participant_key as string,
    revision: Number(row.revision),
    waitingSince: new Date(row.updated_at).toISOString(),
  }));
}
