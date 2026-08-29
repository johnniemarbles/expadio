import type { PoolClient } from 'pg';

/**
 * Decision analytics for the governance lead: for each vertical, how many
 * decisions were recorded and what share were approvals. The summary strip
 * counts decisions by outcome tenant-wide; this breaks the same append-only
 * log down per work type into an approval rate — the "are we rubber-stamping,
 * or is review doing work?" read. Pure aggregation, RLS-scoped; no new tables.
 */

export interface WorkTypeDecisionStat {
  readonly workTypeKey: string;
  readonly total: number;
  readonly approved: number;
  readonly approvalRate: number; // 0..1
}

/** Approvals over total, guarding total = 0 (→ 0). Rounded to 4 dp. */
export function approvalRate(approved: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((approved / total) * 10_000) / 10_000;
}

export async function loadDecisionAnalytics(client: PoolClient): Promise<WorkTypeDecisionStat[]> {
  const result = await client.query(
    `SELECT work_type_key,
            count(*)::int AS total,
            count(*) FILTER (WHERE outcome ILIKE '%APPROVE%')::int AS approved
       FROM platform.workflow_stage_decisions
      GROUP BY work_type_key
      ORDER BY total DESC, work_type_key ASC`,
  );
  return result.rows.map((row) => {
    const total = Number(row.total);
    const approved = Number(row.approved);
    return { workTypeKey: row.work_type_key as string, total, approved, approvalRate: approvalRate(approved, total) };
  });
}
