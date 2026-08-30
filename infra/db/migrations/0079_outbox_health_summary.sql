BEGIN;

-- Domain event outbox health summary
--
-- Tenant-scoped read-only operational rollup over the transactional outbox.
-- This view does not introduce a worker, retry command, recovery mutation, or
-- second queue. It exposes stuck and degraded outbox conditions using the
-- authoritative platform.domain_event_outbox evidence.

CREATE VIEW platform.outbox_health_summary AS
SELECT
  outbox.tenant_id,
  'domain_event_outbox_ready_backlog'::text AS health_key,
  'WATCH'::text AS health_status,
  count(*)::integer AS item_count,
  min(outbox.available_at) AS oldest_at,
  max(outbox.created_at) AS newest_at,
  jsonb_build_object(
    'sourceTable', 'platform.domain_event_outbox',
    'condition', 'status=PENDING and available_at<=now',
    'topics', jsonb_object_agg(outbox.topic, outbox.topic_count ORDER BY outbox.topic),
    'scope', 'tenant'
  ) AS metadata
FROM (
  SELECT
    tenant_id,
    topic,
    available_at,
    created_at,
    count(*) OVER (PARTITION BY tenant_id, topic)::integer AS topic_count
  FROM platform.domain_event_outbox
  WHERE tenant_id = platform.current_tenant_id()
    AND status = 'PENDING'
    AND available_at <= clock_timestamp()
) outbox
GROUP BY outbox.tenant_id

UNION ALL

SELECT
  outbox.tenant_id,
  'domain_event_outbox_retry_due'::text AS health_key,
  'WATCH'::text AS health_status,
  count(*)::integer AS item_count,
  min(outbox.available_at) AS oldest_at,
  max(outbox.updated_at) AS newest_at,
  jsonb_build_object(
    'sourceTable', 'platform.domain_event_outbox',
    'condition', 'status=FAILED and available_at<=now',
    'attempts', jsonb_object_agg(outbox.attempts::text, outbox.attempt_count ORDER BY outbox.attempts::text),
    'scope', 'tenant'
  ) AS metadata
FROM (
  SELECT
    tenant_id,
    attempts,
    available_at,
    updated_at,
    count(*) OVER (PARTITION BY tenant_id, attempts)::integer AS attempt_count
  FROM platform.domain_event_outbox
  WHERE tenant_id = platform.current_tenant_id()
    AND status = 'FAILED'
    AND available_at <= clock_timestamp()
) outbox
GROUP BY outbox.tenant_id

UNION ALL

SELECT
  outbox.tenant_id,
  'domain_event_outbox_future_retry'::text AS health_key,
  'WATCH'::text AS health_status,
  count(*)::integer AS item_count,
  min(outbox.available_at) AS oldest_at,
  max(outbox.updated_at) AS newest_at,
  jsonb_build_object(
    'sourceTable', 'platform.domain_event_outbox',
    'condition', 'status=FAILED and available_at>now',
    'attempts', jsonb_object_agg(outbox.attempts::text, outbox.attempt_count ORDER BY outbox.attempts::text),
    'scope', 'tenant'
  ) AS metadata
FROM (
  SELECT
    tenant_id,
    attempts,
    available_at,
    updated_at,
    count(*) OVER (PARTITION BY tenant_id, attempts)::integer AS attempt_count
  FROM platform.domain_event_outbox
  WHERE tenant_id = platform.current_tenant_id()
    AND status = 'FAILED'
    AND available_at > clock_timestamp()
) outbox
GROUP BY outbox.tenant_id

UNION ALL

SELECT
  outbox.tenant_id,
  'domain_event_outbox_stale_claims'::text AS health_key,
  'DEGRADED'::text AS health_status,
  count(*)::integer AS item_count,
  min(outbox.claimed_at) AS oldest_at,
  max(outbox.updated_at) AS newest_at,
  jsonb_build_object(
    'sourceTable', 'platform.domain_event_outbox',
    'condition', 'status=CLAIMED and claimed_at older than 15 minutes',
    'attempts', jsonb_object_agg(outbox.attempts::text, outbox.attempt_count ORDER BY outbox.attempts::text),
    'scope', 'tenant'
  ) AS metadata
FROM (
  SELECT
    tenant_id,
    attempts,
    claimed_at,
    updated_at,
    count(*) OVER (PARTITION BY tenant_id, attempts)::integer AS attempt_count
  FROM platform.domain_event_outbox
  WHERE tenant_id = platform.current_tenant_id()
    AND status = 'CLAIMED'
    AND claimed_at IS NOT NULL
    AND claimed_at <= clock_timestamp() - interval '15 minutes'
) outbox
GROUP BY outbox.tenant_id

UNION ALL

SELECT
  outbox.tenant_id,
  'domain_event_outbox_dead'::text AS health_key,
  'DEGRADED'::text AS health_status,
  count(*)::integer AS item_count,
  min(outbox.updated_at) AS oldest_at,
  max(outbox.updated_at) AS newest_at,
  jsonb_build_object(
    'sourceTable', 'platform.domain_event_outbox',
    'condition', 'status=DEAD',
    'attempts', jsonb_object_agg(outbox.attempts::text, outbox.attempt_count ORDER BY outbox.attempts::text),
    'scope', 'tenant'
  ) AS metadata
FROM (
  SELECT
    tenant_id,
    attempts,
    updated_at,
    count(*) OVER (PARTITION BY tenant_id, attempts)::integer AS attempt_count
  FROM platform.domain_event_outbox
  WHERE tenant_id = platform.current_tenant_id()
    AND status = 'DEAD'
) outbox
GROUP BY outbox.tenant_id;

COMMENT ON VIEW platform.outbox_health_summary IS
  'Tenant-scoped domain event outbox operations health rollup over pending, failed, claimed, and dead outbox rows.';

COMMIT;
