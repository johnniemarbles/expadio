import type { PoolClient } from 'pg';

/**
 * The tenant-wide governed-decision log: every immutable stage decision across
 * every vertical, newest first. This is the cross-subject complement to the
 * per-subject workflow trace — an oversight view for compliance, reading the
 * same append-only `workflow_stage_decisions` table (RLS-scoped by tenant).
 */

export interface GovernedDecision {
  readonly decidedAt: string;
  readonly workTypeKey: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly stageKey: string;
  readonly outcome: string;
  readonly decidedBySubjectId: string;
  readonly code: string;
  readonly evidenceRefs: readonly string[];
  readonly instanceState: string;
}

export async function loadTenantDecisions(
  client: PoolClient,
  opts: { readonly workTypeKey?: string; readonly limit?: number } = {},
): Promise<GovernedDecision[]> {
  const workTypeKey = (opts.workTypeKey ?? '').trim();
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const result = await client.query(
    `SELECT d.decided_at, d.work_type_key, d.stage_key, d.outcome, d.decided_by_subject_id,
            d.code, d.evidence_refs, i.subject_type, i.subject_id, i.state AS instance_state
       FROM platform.workflow_stage_decisions d
       JOIN platform.workflow_instances i
         ON i.instance_id = d.instance_id AND i.tenant_id = d.tenant_id
      WHERE ($1 = '' OR d.work_type_key = $1)
      ORDER BY d.decided_at DESC
      LIMIT $2`,
    [workTypeKey, limit],
  );
  return result.rows.map((row) => ({
    decidedAt: new Date(row.decided_at).toISOString(),
    workTypeKey: row.work_type_key,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    stageKey: row.stage_key,
    outcome: row.outcome,
    decidedBySubjectId: row.decided_by_subject_id,
    code: row.code,
    evidenceRefs: Array.isArray(row.evidence_refs) ? row.evidence_refs : [],
    instanceState: row.instance_state,
  }));
}
