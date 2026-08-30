BEGIN;

-- Explicit stuck delivery detection
--
-- Extends the existing communication health summary with actionable stuck
-- delivery buckets. This remains a read-only operational read model: no retry,
-- recovery, claim, dispatch or provider-side mutation behavior is introduced.

CREATE OR REPLACE VIEW platform.communication_health_summary AS
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
  'communication_deliveries_stuck_pending'::text AS health_key,
  'DEGRADED'::text AS health_status,
  count(*)::integer AS item_count,
  min(delivery.next_attempt_at) AS oldest_at,
  max(delivery.updated_at) AS newest_at,
  jsonb_build_object(
    'sourceTable', 'platform.communication_deliveries',
    'state', 'PENDING',
    'condition', 'next_attempt_at older than 15 minutes',
    'thresholdSeconds', 900,
    'scope', 'tenant'
  ) AS metadata
FROM platform.communication_deliveries delivery
WHERE delivery.tenant_id = platform.current_tenant_id()
  AND delivery.state = 'PENDING'
  AND delivery.next_attempt_at <= clock_timestamp() - interval '15 minutes'
GROUP BY delivery.tenant_id

UNION ALL

SELECT
  delivery.tenant_id,
  'communication_deliveries_expired_claims'::text AS health_key,
  'CRITICAL'::text AS health_status,
  count(*)::integer AS item_count,
  min(delivery.claim_expires_at) AS oldest_at,
  max(delivery.updated_at) AS newest_at,
  jsonb_build_object(
    'sourceTable', 'platform.communication_deliveries',
    'states', jsonb_object_agg(delivery.state, delivery.state_count ORDER BY delivery.state),
    'condition', 'claim_expires_at is in the past while claim_token is still set',
    'scope', 'tenant'
  ) AS metadata
FROM (
  SELECT
    tenant_id,
    state,
    claim_expires_at,
    updated_at,
    count(*) OVER (PARTITION BY tenant_id, state)::integer AS state_count
  FROM platform.communication_deliveries
  WHERE tenant_id = platform.current_tenant_id()
    AND state IN ('PENDING', 'ACCEPTED', 'SENT')
    AND claim_token IS NOT NULL
    AND claim_expires_at < clock_timestamp()
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
  'Tenant-scoped communication operations health rollup over delivery state, explicit stuck delivery detection, provider attempts, and provider webhook evidence.';

COMMIT;
