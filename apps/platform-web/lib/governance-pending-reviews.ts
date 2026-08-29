import type { PoolClient } from 'pg';

/**
 * The team-wide pending-review load: every open governed instance that is
 * waiting on a *named person* to act, across all verticals, and on whom. The
 * oversight counterpart to a reviewer's personal queue — that answers "what is
 * waiting on me"; this answers "what is waiting on anyone, and who is the
 * bottleneck", which is the question a governance lead asks.
 *
 * An item is pending when a USER participant is ASSIGNED on the stage an open
 * instance currently sits at and no decision has yet been recorded for that
 * stage. Oldest-waiting first, since aging work is the point of the view.
 * Optional filters narrow to one work type or one assignee. Reads the same
 * append-only, RLS-scoped tables the detail views list; no new tables.
 */

export interface PendingReview {
  readonly workTypeKey: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly subjectLabel: string | null;
  readonly state: string;
  readonly currentStageKey: string;
  readonly participantKey: string;
  readonly assigneeSubjectId: string;
  readonly waitingSince: string;
}

export async function loadPendingReviews(
  client: PoolClient,
  opts: { readonly workTypeKey?: string; readonly assignee?: string; readonly limit?: number } = {},
): Promise<PendingReview[]> {
  const workTypeKey = (opts.workTypeKey ?? '').trim();
  const assignee = (opts.assignee ?? '').trim();
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const result = await client.query(
    `SELECT i.work_type_key, i.subject_type, i.subject_id, i.state,
            i.current_stage_key, i.updated_at,
            pa.participant_key, pa.target_key AS assignee,
            COALESCE(ve.legal_name, cc.subject, er.purpose, ar.resource) AS subject_label
       FROM platform.workflow_participant_assignments pa
       JOIN platform.workflow_instances i
         ON i.instance_id = pa.instance_id AND i.tenant_id = pa.tenant_id
       LEFT JOIN platform.vendors ve ON i.work_type_key = 'vendor.onboarding' AND ve.vendor_id::text = i.subject_id
       LEFT JOIN platform.crm_cases cc ON i.work_type_key = 'crm.case' AND cc.case_id::text = i.subject_id
       LEFT JOIN platform.expense_reports er ON i.work_type_key = 'expense.reimbursement' AND er.expense_id::text = i.subject_id
       LEFT JOIN platform.access_requests ar ON i.work_type_key = 'access.request' AND ar.access_request_id::text = i.subject_id
      WHERE pa.target_kind = 'USER'
        AND pa.status = 'ASSIGNED'
        AND pa.stage_key = i.current_stage_key
        AND i.state NOT IN ('COMPLETED','CANCELLED','FAILED')
        AND ($1 = '' OR i.work_type_key = $1)
        AND ($2 = '' OR pa.target_key = $2)
        AND NOT EXISTS (
          SELECT 1 FROM platform.workflow_stage_decisions d
           WHERE d.instance_id = i.instance_id AND d.tenant_id = i.tenant_id
             AND d.stage_key = pa.stage_key
        )
      ORDER BY i.updated_at ASC
      LIMIT $3`,
    [workTypeKey, assignee, limit],
  );
  return result.rows.map((row) => ({
    workTypeKey: row.work_type_key as string,
    subjectType: row.subject_type as string,
    subjectId: row.subject_id as string,
    subjectLabel: (row.subject_label as string | null) ?? null,
    state: row.state as string,
    currentStageKey: row.current_stage_key as string,
    participantKey: row.participant_key as string,
    assigneeSubjectId: row.assignee as string,
    waitingSince: new Date(row.updated_at).toISOString(),
  }));
}
