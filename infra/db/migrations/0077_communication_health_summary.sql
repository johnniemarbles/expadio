BEGIN;

-- Communication health summary
--
-- Tenant-scoped operational read model over communication delivery,
-- provider attempt, and provider webhook evidence. This is deliberately
-- read-only: it does not introduce dispatch, retry, recovery, or mutation
-- behavior.

CREATE VIEW platform.communication_health_summary AS
SELECT
  delivery.tenant_id,
  'communication_deliveries_in_flight'::text AS health_key,
  'WATCH'::text AS health_status,
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
    AND state IN ('PENDING', 'ACCEPTED', 'SENT')
) delivery
GROUP BY delivery.tenant_id

UNION ALL

SELECT
  delivery.tenant_id,
  'communication_deliveries_negative_terminal'::text AS health_key,
  'DEGRADED'::text AS health_status,
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
    AND state IN ('FAILED', 'BOUNCED', 'COMPLAINED')
) delivery
GROUP BY delivery.tenant_id

UNION ALL

SELECT
  attempt.tenant_id,
  'communication_provider_attempt_failures'::text AS health_key,
  'DEGRADED'::text AS health_status,
  count(*)::integer AS item_count,
  min(attempt.started_at) AS oldest_at,
  max(attempt.completed_at) AS newest_at,
  jsonb_build_object(
    'sourceTable', 'platform.communication_provider_attempts',
    'outcomes', jsonb_object_agg(attempt.outcome, attempt.outcome_count ORDER BY attempt.outcome),
    'scope', 'tenant'
  ) AS metadata
FROM (
  SELECT
    tenant_id,
    outcome,
    started_at,
    completed_at,
    count(*) OVER (PARTITION BY tenant_id, outcome)::integer AS outcome_count
  FROM platform.communication_provider_attempts
  WHERE tenant_id = platform.current_tenant_id()
    AND outcome IN ('RETRYABLE_FAILURE', 'REJECTED', 'ERROR')
) attempt
GROUP BY attempt.tenant_id

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
GROUP BY webhook.tenant_id

UNION ALL

SELECT
  webhook.tenant_id,
  'communication_provider_webhooks_negative'::text AS health_key,
  'DEGRADED'::text AS health_status,
  count(*)::integer AS item_count,
  min(webhook.received_at) AS oldest_at,
  max(webhook.processed_at) AS newest_at,
  jsonb_build_object(
    'sourceTable', 'platform.communication_provider_webhook_events',
    'outcomes', jsonb_object_agg(webhook.normalized_outcome, webhook.outcome_count ORDER BY webhook.normalized_outcome),
    'scope', 'tenant'
  ) AS metadata
FROM (
  SELECT
    tenant_id,
    normalized_outcome,
    received_at,
    processed_at,
    count(*) OVER (PARTITION BY tenant_id, normalized_outcome)::integer AS outcome_count
  FROM platform.communication_provider_webhook_events
  WHERE tenant_id = platform.current_tenant_id()
    AND normalized_outcome IN ('BOUNCED', 'COMPLAINED', 'FAILED')
) webhook
GROUP BY webhook.tenant_id;

COMMENT ON VIEW platform.communication_health_summary IS
  'Tenant-scoped communication operations health rollup over delivery state, provider attempts, and provider webhook evidence.';

COMMIT;
