import type { PersistedGovernedActionIntent } from './governed-action-intent.ts';

export interface OperationalTaskSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface OperationalTaskSqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<OperationalTaskSqlResult<Row>>;
}

export type OperationalTaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type OperationalTaskStatus = 'OPEN' | 'COMPLETED' | 'CANCELLED';

export interface PersistedOperationalTask {
  readonly taskId: string;
  readonly tenantId: string;
  readonly sourceActionIntentId: string;
  readonly sourceEventId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly idempotencyKey: string;
  readonly title: string;
  readonly description: string | null;
  readonly assigneeSubjectId: string | null;
  readonly dueAt: Date | null;
  readonly priority: OperationalTaskPriority;
  readonly status: OperationalTaskStatus;
  readonly correlationId: string;
  readonly createdBySubjectId: string;
  readonly createdAt: Date;
}

interface OperationalTaskRow {
  readonly task_id: string;
  readonly tenant_id: string;
  readonly source_action_intent_id: string;
  readonly source_event_id: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly idempotency_key: string;
  readonly title: string;
  readonly description: string | null;
  readonly assignee_subject_id: string | null;
  readonly due_at: Date | string | null;
  readonly priority: OperationalTaskPriority;
  readonly status: OperationalTaskStatus;
  readonly correlation_id: string;
  readonly created_by_subject_id: string;
  readonly created_at: Date | string;
}

const COLUMNS = `
  task_id, tenant_id, source_action_intent_id, source_event_id,
  aggregate_type, aggregate_id, idempotency_key, title, description,
  assignee_subject_id, due_at, priority, status, correlation_id,
  created_by_subject_id, created_at
`;

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapRow(row: OperationalTaskRow): PersistedOperationalTask {
  return {
    taskId: row.task_id,
    tenantId: row.tenant_id,
    sourceActionIntentId: row.source_action_intent_id,
    sourceEventId: row.source_event_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    idempotencyKey: row.idempotency_key,
    title: row.title,
    description: row.description,
    assigneeSubjectId: row.assignee_subject_id,
    dueAt: row.due_at === null ? null : asDate(row.due_at),
    priority: row.priority,
    status: row.status,
    correlationId: row.correlation_id,
    createdBySubjectId: row.created_by_subject_id,
    createdAt: asDate(row.created_at),
  };
}

export async function createOperationalTaskForGovernedAction(
  client: OperationalTaskSqlClient,
  input: {
    readonly intent: PersistedGovernedActionIntent;
    readonly title: string;
    readonly description: string | null;
    readonly assigneeSubjectId: string | null;
    readonly dueAt: Date | null;
    readonly priority: OperationalTaskPriority;
  },
): Promise<{ readonly task: PersistedOperationalTask; readonly replayed: boolean }> {
  const inserted = await client.query<OperationalTaskRow>(
    `INSERT INTO platform.operational_tasks (
       tenant_id, source_action_intent_id, source_event_id, aggregate_type,
       aggregate_id, idempotency_key, title, description, assignee_subject_id,
       due_at, priority, correlation_id, created_by_subject_id
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9,
       $10::timestamptz, $11, $12, $13
     )
     ON CONFLICT (tenant_id, source_action_intent_id) DO NOTHING
     RETURNING ${COLUMNS}`,
    [
      input.intent.tenantId,
      input.intent.actionIntentId,
      input.intent.sourceEventId,
      input.intent.aggregateType,
      input.intent.aggregateId,
      input.intent.idempotencyKey,
      input.title,
      input.description,
      input.assigneeSubjectId,
      input.dueAt,
      input.priority,
      input.intent.correlationId,
      input.intent.requestedBySubjectId,
    ],
  );
  const created = inserted.rows[0];
  if (created !== undefined) return { task: mapRow(created), replayed: false };

  const existing = await client.query<OperationalTaskRow>(
    `SELECT ${COLUMNS}
       FROM platform.operational_tasks
      WHERE tenant_id = $1::uuid
        AND source_action_intent_id = $2::uuid
      LIMIT 1`,
    [input.intent.tenantId, input.intent.actionIntentId],
  );
  const row = existing.rows[0];
  if (row === undefined) throw new Error('OPERATIONAL_TASK_IDEMPOTENCY_CONFLICT');

  if (
    row.idempotency_key !== input.intent.idempotencyKey
    || row.title !== input.title
    || row.description !== input.description
    || row.assignee_subject_id !== input.assigneeSubjectId
    || row.priority !== input.priority
    || (row.due_at === null ? null : asDate(row.due_at).toISOString())
      !== (input.dueAt === null ? null : input.dueAt.toISOString())
  ) {
    throw new Error('OPERATIONAL_TASK_REPLAY_CONFLICT');
  }

  return { task: mapRow(row), replayed: true };
}
