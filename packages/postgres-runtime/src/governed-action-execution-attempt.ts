import type { GovernedActionExecutorClass } from '@expadio/governed-actions';

export type GovernedActionExecutionAttemptState =
  | 'STARTED'
  | 'SUCCEEDED'
  | 'REFUSED'
  | 'FAILED';

export interface GovernedActionExecutionAttempt {
  readonly executionAttemptId: string;
  readonly tenantId: string;
  readonly actionIntentId: string;
  readonly attemptNumber: number;
  readonly executorClass: GovernedActionExecutorClass;
  readonly state: GovernedActionExecutionAttemptState;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly reasonCode: string | null;
  readonly result: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface GovernedActionExecutionAttemptSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface GovernedActionExecutionAttemptSqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<GovernedActionExecutionAttemptSqlResult<Row>>;
}

interface AttemptRow {
  readonly execution_attempt_id: string;
  readonly tenant_id: string;
  readonly action_intent_id: string;
  readonly attempt_number: number;
  readonly executor_class: GovernedActionExecutorClass;
  readonly state: GovernedActionExecutionAttemptState;
  readonly started_at: Date | string;
  readonly finished_at: Date | string | null;
  readonly reason_code: string | null;
  readonly result: Record<string, unknown>;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapAttempt(row: AttemptRow): GovernedActionExecutionAttempt {
  return {
    executionAttemptId: row.execution_attempt_id,
    tenantId: row.tenant_id,
    actionIntentId: row.action_intent_id,
    attemptNumber: row.attempt_number,
    executorClass: row.executor_class,
    state: row.state,
    startedAt: date(row.started_at),
    finishedAt: row.finished_at === null ? null : date(row.finished_at),
    reasonCode: row.reason_code,
    result: row.result,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

const COLUMNS = `
  execution_attempt_id, tenant_id, action_intent_id, attempt_number,
  executor_class, state, started_at, finished_at, reason_code, result,
  created_at, updated_at
`;

/**
 * Creates a new operational execution attempt.
 *
 * The advisory lock serializes retries for one Action Intent so concurrent
 * workers cannot allocate the same attempt number.
 */
export async function beginGovernedActionExecutionAttempt(
  client: GovernedActionExecutionAttemptSqlClient,
  input: {
    readonly tenantId: string;
    readonly actionIntentId: string;
    readonly executorClass: GovernedActionExecutorClass;
  },
): Promise<GovernedActionExecutionAttempt> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [`${input.tenantId}|${input.actionIntentId}`],
  );

  const next = await client.query<{ readonly next_attempt_number: number }>(
    `SELECT COALESCE(MAX(attempt_number), 0)::int + 1 AS next_attempt_number
       FROM platform.governed_action_execution_attempts
      WHERE tenant_id = $1::uuid
        AND action_intent_id = $2::uuid`,
    [input.tenantId, input.actionIntentId],
  );
  const attemptNumber = next.rows[0]?.next_attempt_number ?? 1;

  const result = await client.query<AttemptRow>(
    `INSERT INTO platform.governed_action_execution_attempts (
       tenant_id, action_intent_id, attempt_number, executor_class
     ) VALUES ($1::uuid, $2::uuid, $3, $4)
     RETURNING ${COLUMNS}`,
    [
      input.tenantId,
      input.actionIntentId,
      attemptNumber,
      input.executorClass,
    ],
  );

  const row = result.rows[0];
  if (row === undefined) throw new Error('GOVERNED_ACTION_EXECUTION_ATTEMPT_CREATE_FAILED');
  return mapAttempt(row);
}

export async function completeGovernedActionExecutionAttempt(
  client: GovernedActionExecutionAttemptSqlClient,
  input: {
    readonly tenantId: string;
    readonly executionAttemptId: string;
    readonly state: Exclude<GovernedActionExecutionAttemptState, 'STARTED'>;
    readonly reasonCode?: string | null;
    readonly result?: Readonly<Record<string, unknown>>;
    readonly finishedAt?: Date;
  },
): Promise<GovernedActionExecutionAttempt> {
  const finishedAt = input.finishedAt ?? new Date();
  const result = await client.query<AttemptRow>(
    `UPDATE platform.governed_action_execution_attempts
        SET state = $3,
            finished_at = $4,
            reason_code = $5,
            result = $6::jsonb,
            updated_at = $4
      WHERE tenant_id = $1::uuid
        AND execution_attempt_id = $2::uuid
        AND state = 'STARTED'
      RETURNING ${COLUMNS}`,
    [
      input.tenantId,
      input.executionAttemptId,
      input.state,
      finishedAt,
      input.reasonCode ?? null,
      JSON.stringify(input.result ?? {}),
    ],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('GOVERNED_ACTION_EXECUTION_ATTEMPT_NOT_STARTABLE');
  }
  return mapAttempt(row);
}

export async function listGovernedActionExecutionAttempts(
  client: GovernedActionExecutionAttemptSqlClient,
  input: { readonly tenantId: string; readonly actionIntentId: string },
): Promise<readonly GovernedActionExecutionAttempt[]> {
  const result = await client.query<AttemptRow>(
    `SELECT ${COLUMNS}
       FROM platform.governed_action_execution_attempts
      WHERE tenant_id = $1::uuid
        AND action_intent_id = $2::uuid
      ORDER BY attempt_number`,
    [input.tenantId, input.actionIntentId],
  );
  return result.rows.map(mapAttempt);
}
