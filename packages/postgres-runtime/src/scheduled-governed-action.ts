import { randomUUID } from 'node:crypto';
import type { GovernedActionExecutorClass } from '@expadio/governed-actions';
import type { PersistedGovernedActionIntent } from './governed-action-intent.ts';

export interface ScheduledGovernedActionSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface ScheduledGovernedActionSqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<ScheduledGovernedActionSqlResult<Row>>;
}

export interface PersistedScheduledGovernedAction {
  readonly scheduledActionId: string;
  readonly tenantId: string;
  readonly parentActionIntentId: string;
  readonly dueAt: Date;
  readonly nextAttemptAt: Date;
  readonly targetExecutorClass: Exclude<GovernedActionExecutorClass, 'SCHEDULE'>;
  readonly targetActionKey: string;
  readonly targetConfiguration: Readonly<Record<string, unknown>>;
  readonly targetIdempotencyKey: string;
  readonly state: 'PENDING' | 'MATERIALIZED' | 'FAILED' | 'CANCELLED';
  readonly childActionIntentId: string | null;
  readonly claimToken: string | null;
  readonly claimExpiresAt: Date | null;
  readonly attemptCount: number;
}

interface ScheduledRow {
  readonly scheduled_action_id: string;
  readonly tenant_id: string;
  readonly parent_action_intent_id: string;
  readonly due_at: Date | string;
  readonly next_attempt_at: Date | string;
  readonly target_executor_class: Exclude<GovernedActionExecutorClass, 'SCHEDULE'>;
  readonly target_action_key: string;
  readonly target_configuration: Record<string, unknown>;
  readonly target_idempotency_key: string;
  readonly state: PersistedScheduledGovernedAction['state'];
  readonly child_action_intent_id: string | null;
  readonly claim_token: string | null;
  readonly claim_expires_at: Date | string | null;
  readonly attempt_count: number;
}

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapScheduled(row: ScheduledRow): PersistedScheduledGovernedAction {
  return {
    scheduledActionId: row.scheduled_action_id,
    tenantId: row.tenant_id,
    parentActionIntentId: row.parent_action_intent_id,
    dueAt: date(row.due_at),
    nextAttemptAt: date(row.next_attempt_at),
    targetExecutorClass: row.target_executor_class,
    targetActionKey: row.target_action_key,
    targetConfiguration: row.target_configuration,
    targetIdempotencyKey: row.target_idempotency_key,
    state: row.state,
    childActionIntentId: row.child_action_intent_id,
    claimToken: row.claim_token,
    claimExpiresAt: row.claim_expires_at === null ? null : date(row.claim_expires_at),
    attemptCount: row.attempt_count,
  };
}

const SELECT_COLUMNS = `
  scheduled_action_id, tenant_id, parent_action_intent_id, due_at, next_attempt_at,
  target_executor_class, target_action_key, target_configuration,
  target_idempotency_key, state, child_action_intent_id, claim_token,
  claim_expires_at, attempt_count
`;

const TARGET_SELECT_COLUMNS = `
  target.scheduled_action_id, target.tenant_id, target.parent_action_intent_id,
  target.due_at, target.next_attempt_at, target.target_executor_class,
  target.target_action_key, target.target_configuration, target.target_idempotency_key,
  target.state, target.child_action_intent_id, target.claim_token,
  target.claim_expires_at, target.attempt_count
`;

export async function persistScheduledGovernedAction(
  client: ScheduledGovernedActionSqlClient,
  input: {
    readonly parentIntent: PersistedGovernedActionIntent;
    readonly dueAt: Date;
    readonly targetExecutorClass: Exclude<GovernedActionExecutorClass, 'SCHEDULE'>;
    readonly targetActionKey: string;
    readonly targetConfiguration: Readonly<Record<string, unknown>>;
  },
): Promise<PersistedScheduledGovernedAction> {
  const targetIdempotencyKey = [
    input.parentIntent.idempotencyKey,
    'scheduled',
    input.targetExecutorClass,
    input.targetActionKey,
  ].join(':');

  const inserted = await client.query<ScheduledRow>(
    `INSERT INTO platform.scheduled_governed_actions (
       tenant_id, parent_action_intent_id, due_at, next_attempt_at, target_executor_class,
       target_action_key, target_configuration, target_idempotency_key
     ) VALUES (
       $1::uuid, $2::uuid, $3::timestamptz, $3::timestamptz, $4, $5, $6::jsonb, $7
     )
     ON CONFLICT (tenant_id, parent_action_intent_id) DO NOTHING
     RETURNING ${SELECT_COLUMNS}`,
    [
      input.parentIntent.tenantId,
      input.parentIntent.actionIntentId,
      input.dueAt,
      input.targetExecutorClass,
      input.targetActionKey,
      JSON.stringify(input.targetConfiguration),
      targetIdempotencyKey,
    ],
  );
  const created = inserted.rows[0];
  if (created !== undefined) return mapScheduled(created);

  const existing = await client.query<ScheduledRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM platform.scheduled_governed_actions
      WHERE tenant_id = $1::uuid
        AND parent_action_intent_id = $2::uuid
      LIMIT 1`,
    [input.parentIntent.tenantId, input.parentIntent.actionIntentId],
  );
  const row = existing.rows[0];
  if (row === undefined) throw new Error('SCHEDULED_ACTION_IDEMPOTENCY_CONFLICT');
  return mapScheduled(row);
}

export async function claimDueScheduledGovernedAction(
  client: ScheduledGovernedActionSqlClient,
  input: { readonly tenantId: string; readonly now?: Date; readonly leaseMs?: number },
): Promise<PersistedScheduledGovernedAction | null> {
  const now = input.now ?? new Date();
  const leaseMs = input.leaseMs ?? 120_000;
  const claimToken = randomUUID();
  const claimExpiresAt = new Date(now.getTime() + leaseMs);

  const result = await client.query<ScheduledRow>(
    `WITH candidate AS (
       SELECT scheduled_action_id
         FROM platform.scheduled_governed_actions
        WHERE tenant_id = $1::uuid
          AND state = 'PENDING'
          AND next_attempt_at <= $2::timestamptz
          AND (claim_token IS NULL OR claim_expires_at <= $2::timestamptz)
        ORDER BY next_attempt_at, due_at, scheduled_action_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     UPDATE platform.scheduled_governed_actions target
        SET claim_token = $3::uuid,
            claim_expires_at = $4::timestamptz,
            attempt_count = attempt_count + 1,
            last_attempt_at = $2::timestamptz,
            updated_at = $2::timestamptz
       FROM candidate
      WHERE target.scheduled_action_id = candidate.scheduled_action_id
      RETURNING ${TARGET_SELECT_COLUMNS}`,
    [input.tenantId, now, claimToken, claimExpiresAt],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapScheduled(row);
}

export async function completeScheduledGovernedAction(
  client: ScheduledGovernedActionSqlClient,
  input: {
    readonly scheduled: PersistedScheduledGovernedAction;
    readonly childActionIntentId: string;
    readonly completedAt?: Date;
  },
): Promise<boolean> {
  const completedAt = input.completedAt ?? new Date();
  const result = await client.query(
    `UPDATE platform.scheduled_governed_actions
        SET state = 'MATERIALIZED',
            child_action_intent_id = $4::uuid,
            claim_token = NULL,
            claim_expires_at = NULL,
            last_reason_code = 'CHILD_ACTION_MATERIALIZED',
            last_reason = NULL,
            updated_at = $5::timestamptz
      WHERE tenant_id = $1::uuid
        AND scheduled_action_id = $2::uuid
        AND state = 'PENDING'
        AND claim_token = $3::uuid
        AND claim_expires_at > $5::timestamptz`,
    [
      input.scheduled.tenantId,
      input.scheduled.scheduledActionId,
      input.scheduled.claimToken,
      input.childActionIntentId,
      completedAt,
    ],
  );
  return result.rowCount === 1;
}


export async function retryOrFailScheduledGovernedAction(
  client: ScheduledGovernedActionSqlClient,
  input: {
    readonly scheduled: PersistedScheduledGovernedAction;
    readonly failedAt?: Date;
    readonly maxAttempts: number;
    readonly reasonCode: string;
    readonly reason: string | null;
    readonly retryAfterMs?: number;
  },
): Promise<'RETRY_SCHEDULED' | 'FAILED' | 'STALE_CLAIM'> {
  const failedAt = input.failedAt ?? new Date();
  if (input.scheduled.claimToken === null) return 'STALE_CLAIM';

  if (input.scheduled.attemptCount >= input.maxAttempts) {
    const terminal = await client.query(
      `UPDATE platform.scheduled_governed_actions
          SET state = 'FAILED',
              claim_token = NULL,
              claim_expires_at = NULL,
              last_reason_code = $4,
              last_reason = $5,
              updated_at = $6::timestamptz
        WHERE tenant_id = $1::uuid
          AND scheduled_action_id = $2::uuid
          AND state = 'PENDING'
          AND claim_token = $3::uuid
          AND claim_expires_at > $6::timestamptz`,
      [
        input.scheduled.tenantId,
        input.scheduled.scheduledActionId,
        input.scheduled.claimToken,
        input.reasonCode,
        input.reason,
        failedAt,
      ],
    );
    return terminal.rowCount === 1 ? 'FAILED' : 'STALE_CLAIM';
  }

  const fallbackDelay = Math.min(15 * 60_000, 30_000 * Math.max(1, input.scheduled.attemptCount));
  const retryAfterMs = Math.max(1_000, input.retryAfterMs ?? fallbackDelay);
  const nextAttemptAt = new Date(failedAt.getTime() + retryAfterMs);
  const retried = await client.query(
    `UPDATE platform.scheduled_governed_actions
        SET next_attempt_at = $4::timestamptz,
            claim_token = NULL,
            claim_expires_at = NULL,
            last_reason_code = $5,
            last_reason = $6,
            updated_at = $7::timestamptz
      WHERE tenant_id = $1::uuid
        AND scheduled_action_id = $2::uuid
        AND state = 'PENDING'
        AND claim_token = $3::uuid
        AND claim_expires_at > $7::timestamptz`,
    [
      input.scheduled.tenantId,
      input.scheduled.scheduledActionId,
      input.scheduled.claimToken,
      nextAttemptAt,
      input.reasonCode,
      input.reason,
      failedAt,
    ],
  );
  return retried.rowCount === 1 ? 'RETRY_SCHEDULED' : 'STALE_CLAIM';
}
