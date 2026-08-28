import type { PoolClient } from 'pg';

/**
 * At-a-glance counts of governed activity for the tenant — the KPI header for
 * the Governance Center. Pure aggregation of the same append-only data the
 * decision log and in-flight view list in detail (RLS-scoped by tenant).
 */

export interface WorkTypeCount { readonly workTypeKey: string; readonly count: number }
export interface OutcomeCount { readonly outcome: string; readonly count: number }

export interface GovernanceSummary {
  readonly openTotal: number;
  readonly openByWorkType: WorkTypeCount[];
  readonly decisionsTotal: number;
  readonly decisionsByOutcome: OutcomeCount[];
}

export async function loadGovernanceSummary(client: PoolClient): Promise<GovernanceSummary> {
  const open = await client.query(
    `SELECT work_type_key, count(*)::int AS n
       FROM platform.workflow_instances
      WHERE state NOT IN ('COMPLETED','CANCELLED','FAILED')
      GROUP BY work_type_key
      ORDER BY n DESC, work_type_key ASC`,
  );
  const decisions = await client.query(
    `SELECT outcome, count(*)::int AS n
       FROM platform.workflow_stage_decisions
      GROUP BY outcome
      ORDER BY n DESC, outcome ASC`,
  );
  const openByWorkType = open.rows.map((r) => ({ workTypeKey: r.work_type_key as string, count: Number(r.n) }));
  const decisionsByOutcome = decisions.rows.map((r) => ({ outcome: r.outcome as string, count: Number(r.n) }));
  return {
    openTotal: openByWorkType.reduce((a, r) => a + r.count, 0),
    openByWorkType,
    decisionsTotal: decisionsByOutcome.reduce((a, r) => a + r.count, 0),
    decisionsByOutcome,
  };
}
