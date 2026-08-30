import type {
  GovernedActionExecutionAttempt,
  PersistedGovernedActionExecutionAttempt,
} from '@expadio/governed-actions';

export interface GovernedActionExecutionSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface GovernedActionExecutionSqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<GovernedActionExecutionSqlResult<Row>>;
}

interface ExecutionRow {
  readonly execution_attempt_id: string;
  readonly tenant_id: string;
  readonly action_intent_id: string;
  readonly executor_class: GovernedActionExecutionAttempt['executorClass'];
  readonly attempt_key: string;
  readonly status: GovernedActionExecutionAttempt['status'];
  readonly started_at: Date | string;
  readonly completed_at: Date | string;
  readonly reason_code: string;
  readonly reason: string | null;
  readonly output_reference: string | null;
  readonly metadata: Record<string, unknown>;
  readonly created_at: Date | string;
}

const COLUMNS = `
  execution_attempt_id, tenant_id, action_intent_id, executor_class,
  attempt_key, status, started_at, completed_at, reason_code, reason,
  output_reference, metadata, created_at
`;

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapRow(row: ExecutionRow): PersistedGovernedActionExecutionAttempt {
  return {
    executionAttemptId: row.execution_attempt_id,
    tenantId: row.tenant_id,
    actionIntentId: row.action_intent_id,
    executorClass: row.executor_class,
    attemptKey: row.attempt_key,
    status: row.status,
    startedAt: asDate(row.started_at),
    completedAt: asDate(row.completed_at),
    reasonCode: row.reason_code,
    reason: row.reason,
    outputReference: row.output_reference,
    metadata: row.metadata,
    createdAt: asDate(row.created_at),
  };
}

/**
 * Persist one immutable executor outcome. Replaying the same executor phase for
 * an Action Intent returns the original record rather than duplicating it.
 */
export async function persistGovernedActionExecutionAttempt(
  client: GovernedActionExecutionSqlClient,
  attempt: GovernedActionExecutionAttempt,
): Promise<PersistedGovernedActionExecutionAttempt> {
  const inserted = await client.query<ExecutionRow>(
    `INSERT INTO platform.governed_action_execution_attempts (
       tenant_id, action_intent_id, executor_class, attempt_key, status,
       started_at, completed_at, reason_code, reason, output_reference, metadata
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4, $5,
       $6, $7, $8, $9, $10, $11::jsonb
     )
     ON CONFLICT (tenant_id, action_intent_id, attempt_key) DO NOTHING
     RETURNING ${COLUMNS}`,
    [
      attempt.tenantId,
      attempt.actionIntentId,
      attempt.executorClass,
      attempt.attemptKey,
      attempt.status,
      attempt.startedAt,
      attempt.completedAt,
      attempt.reasonCode,
      attempt.reason,
      attempt.outputReference,
      JSON.stringify(attempt.metadata),
    ],
  );

  const created = inserted.rows[0];
  if (created !== undefined) return mapRow(created);

  const existing = await client.query<ExecutionRow>(
    `SELECT ${COLUMNS}
       FROM platform.governed_action_execution_attempts
      WHERE tenant_id = $1::uuid
        AND action_intent_id = $2::uuid
        AND attempt_key = $3
      LIMIT 1`,
    [attempt.tenantId, attempt.actionIntentId, attempt.attemptKey],
  );
  const row = existing.rows[0];
  if (row === undefined) {
    throw new Error('GOVERNED_ACTION_EXECUTION_ATTEMPT_IDEMPOTENCY_CONFLICT');
  }

  if (
    row.executor_class !== attempt.executorClass
    || row.status !== attempt.status
    || row.reason_code !== attempt.reasonCode
    || row.output_reference !== attempt.outputReference
  ) {
    throw new Error('GOVERNED_ACTION_EXECUTION_ATTEMPT_IDEMPOTENCY_COLLISION');
  }

  return mapRow(row);
}

export async function listGovernedActionExecutionAttempts(
  client: GovernedActionExecutionSqlClient,
  input: { readonly tenantId: string; readonly actionIntentId: string },
): Promise<readonly PersistedGovernedActionExecutionAttempt[]> {
  const result = await client.query<ExecutionRow>(
    `SELECT ${COLUMNS}
       FROM platform.governed_action_execution_attempts
      WHERE tenant_id = $1::uuid
        AND action_intent_id = $2::uuid
      ORDER BY created_at, execution_attempt_id`,
    [input.tenantId, input.actionIntentId],
  );
  return result.rows.map(mapRow);
}
