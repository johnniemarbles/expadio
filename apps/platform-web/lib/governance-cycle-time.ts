import type { PoolClient } from 'pg';

/**
 * Time-to-decision (cycle time) per vertical: for each recorded decision, how
 * long the instance sat on the stage before it was decided — the gap between
 * entering the stage (its latest transition in) and the decision. Averaged and
 * maxed per work type, this is the "how long do approvals actually take?" read
 * that complements the approval rate. Reads the append-only transition and
 * decision logs, RLS-scoped; no new tables.
 */

export interface WorkTypeCycleTime {
  readonly workTypeKey: string;
  readonly decided: number;
  readonly avgSeconds: number;
  readonly maxSeconds: number;
}

/** A compact human duration: seconds, minutes, hours or days, one unit. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(s / 3_600);
  if (h < 48) return `${h}h`;
  return `${Math.round(s / 86_400)}d`;
}

export async function loadDecisionCycleTime(client: PoolClient): Promise<WorkTypeCycleTime[]> {
  // Pair each decision with the latest transition INTO its stage at or before the
  // decision — the moment the instance entered the stage it was decided on.
  const result = await client.query(
    `SELECT d.work_type_key,
            count(*)::int AS decided,
            avg(EXTRACT(EPOCH FROM (d.decided_at - t.entered_at)))::float8 AS avg_seconds,
            max(EXTRACT(EPOCH FROM (d.decided_at - t.entered_at)))::float8 AS max_seconds
       FROM platform.workflow_stage_decisions d
       JOIN LATERAL (
         SELECT max(tr.transitioned_at) AS entered_at
           FROM platform.workflow_instance_transitions tr
          WHERE tr.instance_id = d.instance_id AND tr.tenant_id = d.tenant_id
            AND tr.to_stage_key = d.stage_key
            AND tr.transitioned_at <= d.decided_at
       ) t ON t.entered_at IS NOT NULL
      GROUP BY d.work_type_key
      ORDER BY avg_seconds DESC NULLS LAST, d.work_type_key ASC`,
  );
  return result.rows.map((row) => ({
    workTypeKey: row.work_type_key as string,
    decided: Number(row.decided),
    avgSeconds: Number(row.avg_seconds),
    maxSeconds: Number(row.max_seconds),
  }));
}
