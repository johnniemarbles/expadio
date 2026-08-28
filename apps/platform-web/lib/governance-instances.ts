import type { PoolClient } from 'pg';

/**
 * The tenant-wide in-flight workflow view: every governed instance across every
 * vertical, with the stage it currently sits at. The companion to the
 * governed-decision log — that shows what was decided; this shows what is still
 * running and where. Reads `workflow_instances` (RLS-scoped by tenant).
 */

const TERMINAL = new Set(['COMPLETED', 'CANCELLED', 'FAILED']);

export interface GovernedInstance {
  readonly workTypeKey: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly state: string;
  readonly currentStageKey: string | null;
  readonly revision: number;
  readonly startedAt: string | null;
  readonly updatedAt: string;
}

export async function loadTenantInstances(
  client: PoolClient,
  opts: { readonly workTypeKey?: string; readonly state?: string; readonly limit?: number } = {},
): Promise<GovernedInstance[]> {
  const workTypeKey = (opts.workTypeKey ?? '').trim();
  const state = (opts.state ?? '').trim().toUpperCase();
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  // No explicit state → the open (non-terminal) instances, which is the point of
  // an oversight view. An explicit state narrows to exactly that state.
  const result = await client.query(
    `SELECT work_type_key, subject_type, subject_id, state, current_stage_key,
            revision, started_at, updated_at
       FROM platform.workflow_instances
      WHERE ($1 = '' OR work_type_key = $1)
        AND ($2 = '' OR state = $2)
        AND ($2 <> '' OR state NOT IN ('COMPLETED','CANCELLED','FAILED'))
      ORDER BY updated_at DESC
      LIMIT $3`,
    [workTypeKey, state, limit],
  );
  return result.rows.map((row) => ({
    workTypeKey: row.work_type_key,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    state: row.state,
    currentStageKey: row.current_stage_key ?? null,
    revision: Number(row.revision),
    startedAt: row.started_at === null || row.started_at === undefined ? null : new Date(row.started_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

/** Whether a state is terminal — exposed for surfaces that badge open vs. done. */
export function isTerminalState(state: string): boolean {
  return TERMINAL.has(state.toUpperCase());
}
