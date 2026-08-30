BEGIN;

-- Scheduler health summary
--
-- Tenant-scoped operational read model over existing scheduling control-plane
-- and execution evidence. This view is deliberately read-only: it does not
-- introduce a queue, worker, retry mechanism, or recovery command path.
--
-- It gives operators one compact rollup surface for scheduler-specific P0
-- conditions:
--   - enabled scheduler targets that are due for selection
--   - disabled scheduler targets that make a tenant unscheduled
--   - tenant execution leases that have expired while still attached
--   - failed or lease-lost tenant execution runs
--   - due scheduled governed actions that have not materialized a child action

CREATE VIEW platform.scheduler_health_summary AS
SELECT
  target.tenant_id,
  'scheduler_targets_due'::text AS health_key,
  'WATCH'::text AS health_status,
  count(*)::integer AS item_count,
  min(target.next_scheduled_at) AS oldest_at,
  max(COALESCE(target.last_selected_at, target.next_scheduled_at)) AS newest_at,
  jsonb_build_object(
    'sourceTable', 'platform.domain_event_scheduler_targets',
    'condition', 'execution_enabled=true and next_scheduled_at<=now',
    'cadenceSeconds', jsonb_object_agg(target.cadence_seconds::text, target.cadence_count ORDER BY target.cadence_seconds::text),
    'scope', 'tenant'
  ) AS metadata
FROM (
  SELECT
    tenant_id,
    cadence_seconds,
    next_scheduled_at,
    last_selected_at,
    count(*) OVER (PARTITION BY tenant_id, cadence_seconds)::integer AS cadence_count
  FROM platform.domain_event_scheduler_targets
  WHERE tenant_id = platform.current_tenant_id()
    AND execution_enabled = true
    AND next_scheduled_at <= clock_timestamp()
) target
GROUP BY target.tenant_id

UNION ALL

SELECT
  target.tenant_id,
  'scheduler_targets_disabled'::text AS health_key,
  'WATCH'::text AS health_status,
  count(*)::integer AS item_count,
  min(target.created_at) AS oldest_at,
  max(target.updated_at) AS newest_at,
  jsonb_build_object(
    'sourceTable', 'platform.domain_event_scheduler_targets',
    'condition', 'execution_enabled=false',
    'lastResults', COALESCE(jsonb_object_agg(target.last_result, target.result_count ORDER BY target.last_result) FILTER (WHERE target.last_result IS NOT NULL), '{}'::jsonb),
    'scope', 'tenant'
  ) AS metadata
FROM (
  SELECT
    tenant_id,
    last_result,
    created_at,
    updated_at,
    count(*) OVER (PARTITION BY tenant_id, last_result)::integer AS result_count
  FROM platform.domain_event_scheduler_targets
  WHERE tenant_id = platform.current_tenant_id()
    AND execution_enabled = false
) target
GROUP BY target.tenant_id

UNION ALL

SELECT
  state.tenant_id,
  'scheduler_execution_expired_leases'::text AS health_key,
  'DEGRADED'::text AS health_status,
  count(*)::integer AS item_count,
  min(state.lease_expires_at) AS oldest_at,
  max(COALESCE(state.last_started_at, state.updated_at)) AS newest_at,
  jsonb_build_object(
    'sourceTable', 'platform.domain_event_tenant_execution_state',
    'condition', 'current_run_id set and lease_expires_at<=now',
    'scope', 'tenant'
  ) AS metadata
FROM platform.domain_event_tenant_execution_state state
WHERE state.tenant_id = platform.current_tenant_id()
  AND state.current_run_id IS NOT NULL
  AND state.lease_expires_at <= clock_timestamp()
GROUP BY state.tenant_id

UNION ALL

SELECT
  run.tenant_id,
  'scheduler_execution_failed_runs'::text AS health_key,
  CASE
    WHEN bool_or(run.status = 'FAILED') THEN 'DEGRADED'
    ELSE 'WATCH'
  END AS health_status,
  count(*)::integer AS item_count,
  min(run.started_at) AS oldest_at,
  max(run.finished_at) AS newest_at,
  jsonb_build_object(
    'sourceTable', 'platform.domain_event_tenant_execution_runs',
    'statuses', jsonb_object_agg(run.status, run.status_count ORDER BY run.status),
    'scope', 'tenant'
  ) AS metadata
FROM (
  SELECT
    tenant_id,
    status,
    started_at,
    finished_at,
    count(*) OVER (PARTITION BY tenant_id, status)::integer AS status_count
  FROM platform.domain_event_tenant_execution_runs
  WHERE tenant_id = platform.current_tenant_id()
    AND status IN ('FAILED', 'LEASE_LOST')
) run
GROUP BY run.tenant_id

UNION ALL

SELECT
  scheduled.tenant_id,
  'scheduler_scheduled_actions_due_unmaterialized'::text AS health_key,
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
GROUP BY scheduled.tenant_id;

COMMENT ON VIEW platform.scheduler_health_summary IS
  'Tenant-scoped scheduler operations health rollup over scheduler targets, tenant execution state/runs, and scheduled governed actions.';

COMMIT;
