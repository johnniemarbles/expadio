import { factsFromFrozenExecutorRows, type FrozenExecutorRow } from '@expadio/tenancy';

export const FROZEN_EXECUTOR_FACT_QUERY = `
SELECT i.correlation_id AS correlation,
       i.executor_class AS executor,
       a.status AS attempt_status
  FROM platform.governed_action_intents i
  LEFT JOIN LATERAL (
    SELECT e.status
      FROM platform.governed_action_execution_attempts e
     WHERE e.tenant_id = i.tenant_id
       AND e.action_intent_id = i.action_intent_id
     ORDER BY e.created_at DESC, e.execution_attempt_id DESC
     LIMIT 1
  ) a ON true
 WHERE i.correlation_id = $1
   AND i.executor_class IN ('SCHEDULE', 'CREATE_TASK', 'COMMUNICATE')
 ORDER BY i.created_at ASC
`;

export type JourneyFactSqlClient = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
};

/** Read intent + latest attempt only. Never configuration, metadata, or recipients. */
export async function readFrozenExecutorRows(
  client: JourneyFactSqlClient,
  correlation: string,
): Promise<readonly FrozenExecutorRow[]> {
  const result = await client.query<{
    correlation: string;
    executor: string;
    attempt_status: string | null;
  }>(FROZEN_EXECUTOR_FACT_QUERY, [correlation]);
  return result.rows.map((row) => ({
    correlation: row.correlation,
    executor: row.executor,
    attemptStatus: row.attempt_status,
  }));
}

export function journeyFactsFromRows(correlation: string, rows: readonly FrozenExecutorRow[]) {
  return factsFromFrozenExecutorRows(correlation, rows);
}
