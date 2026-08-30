BEGIN;

-- Business execution trace
--
-- A tenant-scoped read model that presents the causal chain from a business
-- Domain Event through outbox publication, governed actions, scheduled actions,
-- communication delivery/provider attempts, and operational tasks.
--
-- This is deliberately a read model over existing authoritative tables. It does
-- not introduce execution state and it does not mutate worker semantics.

CREATE VIEW platform.business_execution_trace AS
SELECT
  event.tenant_id,
  event.correlation_id,
  event.event_id AS root_event_id,
  event.event_type AS root_event_type,
  event.aggregate_type,
  event.aggregate_id,
  event.occurred_at AS trace_at,
  'DOMAIN_EVENT'::text AS trace_kind,
  ('domain_event:' || event.event_id::text) AS trace_id,
  CASE
    WHEN event.causation_id IS NULL THEN NULL
    ELSE ('causation:' || event.causation_id)
  END AS parent_trace_id,
  NULL::text AS executor_class,
  event.event_type AS action_key,
  'RECORDED'::text AS state,
  NULL::text AS reason_code,
  event.event_type AS summary,
  jsonb_build_object(
    'eventId', event.event_id,
    'eventVersion', event.event_version,
    'actorSubjectId', event.actor_subject_id,
    'packKey', event.pack_key,
    'packVersion', event.pack_version,
    'recordedAt', event.recorded_at
  ) AS metadata
FROM platform.domain_events event
WHERE event.tenant_id = platform.current_tenant_id()

UNION ALL

SELECT
  event.tenant_id,
  event.correlation_id,
  event.event_id AS root_event_id,
  event.event_type AS root_event_type,
  event.aggregate_type,
  event.aggregate_id,
  COALESCE(outbox.published_at, outbox.claimed_at, outbox.available_at, outbox.created_at) AS trace_at,
  'DOMAIN_EVENT_OUTBOX'::text AS trace_kind,
  ('domain_event_outbox:' || outbox.outbox_id::text) AS trace_id,
  ('domain_event:' || event.event_id::text) AS parent_trace_id,
  NULL::text AS executor_class,
  outbox.topic AS action_key,
  outbox.status AS state,
  NULL::text AS reason_code,
  ('Outbox ' || outbox.status) AS summary,
  jsonb_build_object(
    'outboxId', outbox.outbox_id,
    'eventId', outbox.event_id,
    'topic', outbox.topic,
    'partitionKey', outbox.partition_key,
    'attempts', outbox.attempts,
    'lastError', outbox.last_error,
    'publishedAt', outbox.published_at
  ) AS metadata
FROM platform.domain_event_outbox outbox
JOIN platform.domain_events event
  ON event.tenant_id = outbox.tenant_id
 AND event.event_id = outbox.event_id
WHERE event.tenant_id = platform.current_tenant_id()

UNION ALL

SELECT
  event.tenant_id,
  action.correlation_id,
  event.event_id AS root_event_id,
  event.event_type AS root_event_type,
  action.aggregate_type,
  action.aggregate_id,
  action.requested_at AS trace_at,
  'GOVERNED_ACTION'::text AS trace_kind,
  ('governed_action:' || action.action_intent_id::text) AS trace_id,
  CASE
    WHEN schedule_parent.scheduled_action_id IS NOT NULL THEN
      ('scheduled_action:' || schedule_parent.scheduled_action_id::text)
    ELSE ('domain_event:' || action.source_event_id::text)
  END AS parent_trace_id,
  action.executor_class,
  action.action_key,
  'REQUESTED'::text AS state,
  (action.policy_decision ->> 'reasonCode') AS reason_code,
  (action.executor_class || ' ' || action.action_key) AS summary,
  jsonb_build_object(
    'actionIntentId', action.action_intent_id,
    'ruleKey', action.rule_key,
    'idempotencyKey', action.idempotency_key,
    'causationId', action.causation_id,
    'requestedBySubjectId', action.requested_by_subject_id,
    'policyDecision', action.policy_decision,
    'configuration', action.configuration
  ) AS metadata
FROM platform.governed_action_intents action
JOIN platform.domain_events event
  ON event.tenant_id = action.tenant_id
 AND event.event_id = action.source_event_id
LEFT JOIN platform.scheduled_governed_actions schedule_parent
  ON schedule_parent.tenant_id = action.tenant_id
 AND schedule_parent.child_action_intent_id = action.action_intent_id
WHERE action.tenant_id = platform.current_tenant_id()

UNION ALL

SELECT
  event.tenant_id,
  action.correlation_id,
  event.event_id AS root_event_id,
  event.event_type AS root_event_type,
  action.aggregate_type,
  action.aggregate_id,
  attempt.completed_at AS trace_at,
  'GOVERNED_ACTION_ATTEMPT'::text AS trace_kind,
  ('governed_action_attempt:' || attempt.execution_attempt_id::text) AS trace_id,
  ('governed_action:' || action.action_intent_id::text) AS parent_trace_id,
  attempt.executor_class,
  action.action_key,
  attempt.status AS state,
  attempt.reason_code,
  COALESCE(attempt.reason, attempt.status) AS summary,
  jsonb_build_object(
    'executionAttemptId', attempt.execution_attempt_id,
    'attemptKey', attempt.attempt_key,
    'startedAt', attempt.started_at,
    'completedAt', attempt.completed_at,
    'outputReference', attempt.output_reference,
    'metadata', attempt.metadata
  ) AS metadata
FROM platform.governed_action_execution_attempts attempt
JOIN platform.governed_action_intents action
  ON action.tenant_id = attempt.tenant_id
 AND action.action_intent_id = attempt.action_intent_id
JOIN platform.domain_events event
  ON event.tenant_id = action.tenant_id
 AND event.event_id = action.source_event_id
WHERE attempt.tenant_id = platform.current_tenant_id()

UNION ALL

SELECT
  event.tenant_id,
  parent.correlation_id,
  event.event_id AS root_event_id,
  event.event_type AS root_event_type,
  parent.aggregate_type,
  parent.aggregate_id,
  schedule.due_at AS trace_at,
  'SCHEDULED_ACTION'::text AS trace_kind,
  ('scheduled_action:' || schedule.scheduled_action_id::text) AS trace_id,
  ('governed_action:' || schedule.parent_action_intent_id::text) AS parent_trace_id,
  schedule.target_executor_class AS executor_class,
  schedule.target_action_key AS action_key,
  schedule.state,
  schedule.last_reason_code AS reason_code,
  ('Scheduled ' || schedule.target_executor_class || ' ' || schedule.target_action_key) AS summary,
  jsonb_build_object(
    'scheduledActionId', schedule.scheduled_action_id,
    'parentActionIntentId', schedule.parent_action_intent_id,
    'childActionIntentId', schedule.child_action_intent_id,
    'dueAt', schedule.due_at,
    'nextAttemptAt', schedule.next_attempt_at,
    'attemptCount', schedule.attempt_count,
    'lastAttemptAt', schedule.last_attempt_at,
    'lastReason', schedule.last_reason,
    'targetIdempotencyKey', schedule.target_idempotency_key,
    'targetConfiguration', schedule.target_configuration
  ) AS metadata
FROM platform.scheduled_governed_actions schedule
JOIN platform.governed_action_intents parent
  ON parent.tenant_id = schedule.tenant_id
 AND parent.action_intent_id = schedule.parent_action_intent_id
JOIN platform.domain_events event
  ON event.tenant_id = parent.tenant_id
 AND event.event_id = parent.source_event_id
WHERE schedule.tenant_id = platform.current_tenant_id()

UNION ALL

SELECT
  event.tenant_id,
  action.correlation_id,
  event.event_id AS root_event_id,
  event.event_type AS root_event_type,
  action.aggregate_type,
  action.aggregate_id,
  delivery.requested_at AS trace_at,
  'COMMUNICATION_DELIVERY'::text AS trace_kind,
  ('communication_delivery:' || delivery.delivery_id::text) AS trace_id,
  ('governed_action:' || action.action_intent_id::text) AS parent_trace_id,
  action.executor_class,
  action.action_key,
  delivery.state,
  delivery.last_reason_code AS reason_code,
  ('Communication delivery ' || delivery.state) AS summary,
  jsonb_build_object(
    'deliveryId', delivery.delivery_id,
    'idempotencyKey', delivery.idempotency_key,
    'channel', delivery.channel,
    'connectorKey', delivery.connector_key,
    'adapterKey', delivery.adapter_key,
    'providerMessageId', delivery.provider_message_id,
    'attemptCount', delivery.attempt_count,
    'lastReason', delivery.last_reason,
    'acceptedAt', delivery.accepted_at
  ) AS metadata
FROM platform.communication_deliveries delivery
JOIN platform.governed_action_intents action
  ON action.tenant_id = delivery.tenant_id
 AND action.idempotency_key = delivery.idempotency_key
JOIN platform.domain_events event
  ON event.tenant_id = action.tenant_id
 AND event.event_id = action.source_event_id
WHERE delivery.tenant_id = platform.current_tenant_id()

UNION ALL

SELECT
  event.tenant_id,
  action.correlation_id,
  event.event_id AS root_event_id,
  event.event_type AS root_event_type,
  action.aggregate_type,
  action.aggregate_id,
  provider_attempt.completed_at AS trace_at,
  'COMMUNICATION_PROVIDER_ATTEMPT'::text AS trace_kind,
  ('communication_provider_attempt:' || provider_attempt.provider_attempt_id::text) AS trace_id,
  ('communication_delivery:' || delivery.delivery_id::text) AS parent_trace_id,
  action.executor_class,
  action.action_key,
  provider_attempt.outcome AS state,
  provider_attempt.reason_code,
  COALESCE(provider_attempt.reason, provider_attempt.outcome) AS summary,
  jsonb_build_object(
    'providerAttemptId', provider_attempt.provider_attempt_id,
    'deliveryId', provider_attempt.delivery_id,
    'attemptToken', provider_attempt.attempt_token,
    'connectorKey', provider_attempt.connector_key,
    'providerKey', provider_attempt.provider_key,
    'adapterKey', provider_attempt.adapter_key,
    'idempotencyKey', provider_attempt.idempotency_key,
    'providerMessageId', provider_attempt.provider_message_id,
    'startedAt', provider_attempt.started_at,
    'completedAt', provider_attempt.completed_at,
    'recordedAt', provider_attempt.recorded_at
  ) AS metadata
FROM platform.communication_provider_attempts provider_attempt
JOIN platform.communication_deliveries delivery
  ON delivery.tenant_id = provider_attempt.tenant_id
 AND delivery.delivery_id = provider_attempt.delivery_id
JOIN platform.governed_action_intents action
  ON action.tenant_id = delivery.tenant_id
 AND action.idempotency_key = delivery.idempotency_key
JOIN platform.domain_events event
  ON event.tenant_id = action.tenant_id
 AND event.event_id = action.source_event_id
WHERE provider_attempt.tenant_id = platform.current_tenant_id()

UNION ALL

SELECT
  event.tenant_id,
  task.correlation_id,
  event.event_id AS root_event_id,
  event.event_type AS root_event_type,
  task.aggregate_type,
  task.aggregate_id,
  task.created_at AS trace_at,
  'OPERATIONAL_TASK'::text AS trace_kind,
  ('operational_task:' || task.task_id::text) AS trace_id,
  ('governed_action:' || task.source_action_intent_id::text) AS parent_trace_id,
  action.executor_class,
  action.action_key,
  task.status AS state,
  NULL::text AS reason_code,
  task.title AS summary,
  jsonb_build_object(
    'taskId', task.task_id,
    'sourceActionIntentId', task.source_action_intent_id,
    'idempotencyKey', task.idempotency_key,
    'description', task.description,
    'assigneeSubjectId', task.assignee_subject_id,
    'dueAt', task.due_at,
    'priority', task.priority,
    'createdBySubjectId', task.created_by_subject_id
  ) AS metadata
FROM platform.operational_tasks task
JOIN platform.governed_action_intents action
  ON action.tenant_id = task.tenant_id
 AND action.action_intent_id = task.source_action_intent_id
JOIN platform.domain_events event
  ON event.tenant_id = task.tenant_id
 AND event.event_id = task.source_event_id
WHERE task.tenant_id = platform.current_tenant_id();

COMMENT ON VIEW platform.business_execution_trace IS
  'Tenant-scoped causal read model from Domain Event to governed action, schedule, delivery, provider attempt, and operational task outcomes.';

COMMIT;
