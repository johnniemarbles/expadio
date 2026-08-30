import type { PoolClient } from 'pg';

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isoNullable(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

export interface ExecutionTrace {
  readonly event: {
    readonly eventId: string;
    readonly eventType: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly occurredAt: string;
    readonly correlationId: string;
    readonly causationId: string | null;
    readonly packKey: string | null;
    readonly packVersion: number | null;
    readonly outbox: {
      readonly status: string;
      readonly attempts: number;
      readonly publishedAt: string | null;
      readonly lastError: string | null;
    } | null;
  };
  readonly actions: readonly {
    readonly actionIntentId: string;
    readonly ruleKey: string;
    readonly executorClass: string;
    readonly actionKey: string;
    readonly idempotencyKey: string;
    readonly causationId: string;
    readonly requestedAt: string;
    readonly attempts: readonly {
      readonly executionAttemptId: string;
      readonly status: string;
      readonly reasonCode: string;
      readonly outputReference: string | null;
      readonly startedAt: string;
      readonly completedAt: string;
    }[];
  }[];
  readonly schedules: readonly {
    readonly scheduledActionId: string;
    readonly parentActionIntentId: string;
    readonly dueAt: string;
    readonly state: string;
    readonly childActionIntentId: string | null;
    readonly lastReasonCode: string | null;
  }[];
  readonly tasks: readonly {
    readonly taskId: string;
    readonly sourceActionIntentId: string;
    readonly title: string;
    readonly assigneeSubjectId: string | null;
    readonly dueAt: string | null;
    readonly priority: string;
    readonly status: string;
    readonly createdAt: string;
  }[];
  readonly deliveries: readonly {
    readonly deliveryId: string;
    readonly idempotencyKey: string;
    readonly state: string;
    readonly connectorKey: string;
    readonly adapterKey: string;
    readonly providerMessageId: string | null;
    readonly attemptCount: number;
    readonly lastReasonCode: string | null;
    readonly acceptedAt: string | null;
    readonly providerAttempts: readonly {
      readonly providerAttemptId: string;
      readonly attemptToken: string;
      readonly providerKey: string;
      readonly outcome: string;
      readonly providerMessageId: string | null;
      readonly reasonCode: string;
      readonly startedAt: string;
      readonly completedAt: string;
    }[];
  }[];
}

export async function loadExecutionTraceForEvent(
  client: PoolClient,
  input: { readonly tenantId: string; readonly eventId: string },
): Promise<ExecutionTrace | null> {
  const eventResult = await client.query<{
    event_id: string;
    event_type: string;
    aggregate_type: string;
    aggregate_id: string;
    occurred_at: Date | string;
    correlation_id: string;
    causation_id: string | null;
    pack_key: string | null;
    pack_version: number | null;
    outbox_status: string | null;
    outbox_attempts: number | null;
    published_at: Date | string | null;
    last_error: string | null;
  }>(
    `SELECT event.event_id, event.event_type, event.aggregate_type, event.aggregate_id,
            event.occurred_at, event.correlation_id, event.causation_id,
            event.pack_key, event.pack_version,
            outbox.status AS outbox_status, outbox.attempts AS outbox_attempts,
            outbox.published_at, outbox.last_error
       FROM platform.domain_events event
       LEFT JOIN platform.domain_event_outbox outbox
         ON outbox.tenant_id = event.tenant_id
        AND outbox.event_id = event.event_id
      WHERE event.tenant_id = $1::uuid
        AND event.event_id = $2::uuid
      LIMIT 1`,
    [input.tenantId, input.eventId],
  );
  const event = eventResult.rows[0];
  if (event === undefined) return null;

  const actionRows = (await client.query<{
    action_intent_id: string;
    rule_key: string;
    executor_class: string;
    action_key: string;
    idempotency_key: string;
    causation_id: string;
    requested_at: Date | string;
  }>(
    `SELECT action_intent_id, rule_key, executor_class, action_key,
            idempotency_key, causation_id, requested_at
       FROM platform.governed_action_intents
      WHERE tenant_id = $1::uuid
        AND source_event_id = $2::uuid
      ORDER BY created_at, action_intent_id`,
    [input.tenantId, input.eventId],
  )).rows;

  const attemptRows = (await client.query<{
    execution_attempt_id: string;
    action_intent_id: string;
    status: string;
    reason_code: string;
    output_reference: string | null;
    started_at: Date | string;
    completed_at: Date | string;
  }>(
    `SELECT execution_attempt_id, action_intent_id, status, reason_code,
            output_reference, started_at, completed_at
       FROM platform.governed_action_execution_attempts
      WHERE tenant_id = $1::uuid
        AND action_intent_id IN (
          SELECT action_intent_id
            FROM platform.governed_action_intents
           WHERE tenant_id = $1::uuid
             AND source_event_id = $2::uuid
        )
      ORDER BY created_at, execution_attempt_id`,
    [input.tenantId, input.eventId],
  )).rows;

  const scheduleRows = (await client.query<{
    scheduled_action_id: string;
    parent_action_intent_id: string;
    due_at: Date | string;
    state: string;
    child_action_intent_id: string | null;
    last_reason_code: string | null;
  }>(
    `SELECT scheduled_action_id, parent_action_intent_id, due_at, state,
            child_action_intent_id, last_reason_code
       FROM platform.scheduled_governed_actions
      WHERE tenant_id = $1::uuid
        AND parent_action_intent_id IN (
          SELECT action_intent_id
            FROM platform.governed_action_intents
           WHERE tenant_id = $1::uuid
             AND source_event_id = $2::uuid
        )
      ORDER BY due_at, scheduled_action_id`,
    [input.tenantId, input.eventId],
  )).rows;

  const taskRows = (await client.query<{
    task_id: string;
    source_action_intent_id: string;
    title: string;
    assignee_subject_id: string | null;
    due_at: Date | string | null;
    priority: string;
    status: string;
    created_at: Date | string;
  }>(
    `SELECT task_id, source_action_intent_id, title, assignee_subject_id,
            due_at, priority, status, created_at
       FROM platform.operational_tasks
      WHERE tenant_id = $1::uuid
        AND source_event_id = $2::uuid
      ORDER BY created_at, task_id`,
    [input.tenantId, input.eventId],
  )).rows;

  const deliveryRows = (await client.query<{
    delivery_id: string;
    idempotency_key: string;
    state: string;
    connector_key: string;
    adapter_key: string;
    provider_message_id: string | null;
    attempt_count: number;
    last_reason_code: string | null;
    accepted_at: Date | string | null;
  }>(
    `SELECT delivery_id, idempotency_key, state, connector_key, adapter_key,
            provider_message_id, attempt_count, last_reason_code, accepted_at
       FROM platform.communication_deliveries
      WHERE tenant_id = $1::uuid
        AND idempotency_key IN (
          SELECT idempotency_key
            FROM platform.governed_action_intents
           WHERE tenant_id = $1::uuid
             AND source_event_id = $2::uuid
        )
      ORDER BY requested_at, delivery_id`,
    [input.tenantId, input.eventId],
  )).rows;

  const providerAttemptRows = (await client.query<{
    provider_attempt_id: string;
    delivery_id: string;
    attempt_token: string;
    provider_key: string;
    outcome: string;
    provider_message_id: string | null;
    reason_code: string;
    started_at: Date | string;
    completed_at: Date | string;
  }>(
    `SELECT provider_attempt_id, delivery_id, attempt_token, provider_key,
            outcome, provider_message_id, reason_code, started_at, completed_at
       FROM platform.communication_provider_attempts
      WHERE tenant_id = $1::uuid
        AND delivery_id IN (
          SELECT delivery_id
            FROM platform.communication_deliveries
           WHERE tenant_id = $1::uuid
             AND idempotency_key IN (
               SELECT idempotency_key
                 FROM platform.governed_action_intents
                WHERE tenant_id = $1::uuid
                  AND source_event_id = $2::uuid
             )
        )
      ORDER BY started_at, provider_attempt_id`,
    [input.tenantId, input.eventId],
  )).rows;

  return {
    event: {
      eventId: event.event_id,
      eventType: event.event_type,
      aggregateType: event.aggregate_type,
      aggregateId: event.aggregate_id,
      occurredAt: iso(event.occurred_at),
      correlationId: event.correlation_id,
      causationId: event.causation_id,
      packKey: event.pack_key,
      packVersion: event.pack_version,
      outbox: event.outbox_status === null ? null : {
        status: event.outbox_status,
        attempts: event.outbox_attempts ?? 0,
        publishedAt: isoNullable(event.published_at),
        lastError: event.last_error,
      },
    },
    actions: actionRows.map((action) => ({
      actionIntentId: action.action_intent_id,
      ruleKey: action.rule_key,
      executorClass: action.executor_class,
      actionKey: action.action_key,
      idempotencyKey: action.idempotency_key,
      causationId: action.causation_id,
      requestedAt: iso(action.requested_at),
      attempts: attemptRows
        .filter((attempt) => attempt.action_intent_id === action.action_intent_id)
        .map((attempt) => ({
          executionAttemptId: attempt.execution_attempt_id,
          status: attempt.status,
          reasonCode: attempt.reason_code,
          outputReference: attempt.output_reference,
          startedAt: iso(attempt.started_at),
          completedAt: iso(attempt.completed_at),
        })),
    })),
    schedules: scheduleRows.map((row) => ({
      scheduledActionId: row.scheduled_action_id,
      parentActionIntentId: row.parent_action_intent_id,
      dueAt: iso(row.due_at),
      state: row.state,
      childActionIntentId: row.child_action_intent_id,
      lastReasonCode: row.last_reason_code,
    })),
    tasks: taskRows.map((row) => ({
      taskId: row.task_id,
      sourceActionIntentId: row.source_action_intent_id,
      title: row.title,
      assigneeSubjectId: row.assignee_subject_id,
      dueAt: isoNullable(row.due_at),
      priority: row.priority,
      status: row.status,
      createdAt: iso(row.created_at),
    })),
    deliveries: deliveryRows.map((row) => ({
      deliveryId: row.delivery_id,
      idempotencyKey: row.idempotency_key,
      state: row.state,
      connectorKey: row.connector_key,
      adapterKey: row.adapter_key,
      providerMessageId: row.provider_message_id,
      attemptCount: row.attempt_count,
      lastReasonCode: row.last_reason_code,
      acceptedAt: isoNullable(row.accepted_at),
      providerAttempts: providerAttemptRows
        .filter((attempt) => attempt.delivery_id === row.delivery_id)
        .map((attempt) => ({
          providerAttemptId: attempt.provider_attempt_id,
          attemptToken: attempt.attempt_token,
          providerKey: attempt.provider_key,
          outcome: attempt.outcome,
          providerMessageId: attempt.provider_message_id,
          reasonCode: attempt.reason_code,
          startedAt: iso(attempt.started_at),
          completedAt: iso(attempt.completed_at),
        })),
    })),
  };
}
