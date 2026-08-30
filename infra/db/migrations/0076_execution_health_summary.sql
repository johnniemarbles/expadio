BEGIN;

-- Execution health summary
--
-- Tenant-scoped operational read model over existing authoritative execution
-- evidence. This view is deliberately read-only: it does not introduce a queue,
-- worker, retry mechanism, or recovery command path.
--
-- It gives operators one compact rollup surface for the most important P0
-- execution conditions:
--   - domain event outbox rows not yet published
--   - failed governed action attempts
--   - due scheduled actions that have not materialized a child action
--   - communication deliveries waiting on dispatch/provider lifecycle
--   - unmatched provider webhooks

CREATE VIEW platform.execution_health_summary AS
SELECT
  outbox.tenant_id,
  'domain_event_outbox_unpublished'::text AS health_key,
  CASE
    WHEN bool_or(outbox.status = 'DEAD') THEN 'CRITICAL'
    WHEN bool_or(outbox.status = 'FAILED') THEN 'DEGRADED'
    ELSE 'WATCH'
  END AS health_status,
  count(*)::integer AS item_count,
  min(COALESCE(outbox.available_at, outbox.created_at)) AS oldest_at,
  max(COALESCE(outbox.published_at, outbox.claimed_at, outbox.available_at, outbox.created_at)) AS newest_at,
  jsonb_build_object(
    'sourceTable', 'platform.domain_event_outbox',
    'statuses', jsonb_object_agg(outbox.status, outbox.status_count ORDER BY outbox.status),
    'scope', 'tenant'
  ) AS metadata
FROM (
  SELECT
    tenant_id,
    status,
    available_at,
    created_at,
    claimed_at,
    published_at,
    count(*) OVER (PARTITION BY tenant_id, status)::integer AS status_count
  FROM platform.domain_event_outbox
  WHERE tenant_id = platform.current_tenant_id()
    AND status <> 'PUBLISHED'
) outbox
GROUP BY outbox.tenant_id

UNION ALL

SELECT
  attempt.tenant_id,
  'governed_action_failed_attempts'::text AS health_key,
  'DEGRADED'::text AS health_status,
  count(*)::integer AS item_count,
  min(attempt.started_at) AS oldest_at,
  max(attempt.completed_at) AS newest_at,
  jsonb_build_object(
    'sourceTable', 'platform.governed_action_execution_attempts',
    'statuses', jsonb_object_agg(attempt.status, attempt.status_count ORDER BY attempt.status),
    'scope', 'tenant'
  ) AS metadata
FROM (
  SELECT
    tenant_id,
    status,
    started_at,
    completed_at,
    count(*) OVER (PARTITION BY tenant_id, status)::integer AS status_count
  FROM platform.governed_action_execution_attempts
  WHERE tenant_id = platform.current_tenant_id()
    AND status IN ('FAILED', 'ERROR')
) attempt
GROUP BY attempt.tenant_id

UNION ALL

SELECT
  scheduled.tenant_id,
  'scheduled_actions_due_unmaterialized'::text AS health_key,
  CASE
    WHEN bool_or(scheduled.state = 'FAILED') THEN 'DEGRADED'
    ELSE 'WATCH'
  END AS health_status,
  count(*)::integer AS item_count,
  min(COALESCE(scheduled.next_attempt_at, scheduled.due_at)) AS oldest_at,
  max(COALESCE(scheduled.last_attempt_at, scheduled.next_attempt_at, scheduled.due_at)) AS newest_at,
  jsonb_build_object(
    'sourceTable', 'platform.scheduled_governed_actions',
    'states', jsonb_object_agg(scheduled.state, scheduled.state_count ORDER BY scheduled.state),
    'scope', 'tenant'
  ) AS metadata
FROM (
  SELECT
    tenant_id,
    state,
    due_at,
    next_attempt_at,
    last_attempt_at,
    count(*) OVER (PARTITION BY tenant_id, state)::integer AS state_count
  FROM platform.scheduled_governed_actions
  WHERE tenant_id = platform.current_tenant_id()
    AND child_action_intent_id IS NULL
    AND COALESCE(next_attempt_at, due_at) <= clock_timestamp()
    AND state NOT IN ('MATERIALIZED', 'CANCELLED')
) scheduled
GROUP BY scheduled.tenant_id

UNION ALL

SELECT
  delivery.tenant_id,
  'communication_deliveries_open'::text AS health_key,
  CASE
    WHEN bool_or(delivery.state = 'FAILED') THEN 'DEGRADED'
    ELSE 'WATCH'
  END AS health_status,
  count(*)::integer AS item_count,
  min(delivery.requested_at) AS oldest_at,
  max(delivery.updated_at) AS newest_at,
  jsonb_build_object(
    'sourceTable', 'platform.communication_deliveries',
    'states', jsonb_object_agg(delivery.state, delivery.state_count ORDER BY delivery.state),
    'scope', 'tenant'
  ) AS metadata
FROM (
  SELECT
    tenant_id,
    state,
    requested_at,
    updated_at,
    count(*) OVER (PARTITION BY tenant_id, state)::integer AS state_count
  FROM platform.communication_deliveries
  WHERE tenant_id = platform.current_tenant_id()
    AND state IN ('PENDING', 'ACCEPTED', 'SENT', 'FAILED')
) delivery
GROUP BY delivery.tenant_id

UNION ALL

SELECT
  webhook.tenant_id,
  'communication_provider_webhooks_unmatched'::text AS health_key,
  'WATCH'::text AS health_status,
  count(*)::integer AS item_count,
  min(webhook.received_at) AS oldest_at,
  max(webhook.processed_at) AS newest_at,
  jsonb_build_object(
    'sourceTable', 'platform.communication_provider_webhook_events',
    'outcome', 'UNMATCHED',
    'scope', 'tenant'
  ) AS metadata
FROM platform.communication_provider_webhook_events webhook
WHERE webhook.tenant_id = platform.current_tenant_id()
  AND webhook.normalized_outcome = 'UNMATCHED'
GROUP BY webhook.tenant_id;

COMMENT ON VIEW platform.execution_health_summary IS
  'Tenant-scoped execution operations health rollup over outbox, governed action attempts, scheduled actions, communication deliveries, and provider webhook evidence.';

COMMIT;
