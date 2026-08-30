BEGIN;

-- Tenant execution orchestration metadata for the Domain Event action runner.
-- This is not a second work queue: the authoritative work remains in
-- platform.domain_event_outbox. These rows only protect/observe scheduler ticks.

CREATE TABLE platform.domain_event_tenant_execution_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  invocation_id uuid NOT NULL,
  lease_token uuid NOT NULL,
  status text NOT NULL CHECK (
    status IN ('RUNNING','SUCCEEDED','FAILED','LEASE_LOST')
  ),
  requested_limit integer NOT NULL CHECK (requested_limit > 0),
  processed integer NOT NULL DEFAULT 0 CHECK (processed >= 0),
  published integer NOT NULL DEFAULT 0 CHECK (published >= 0),
  failed integer NOT NULL DEFAULT 0 CHECK (failed >= 0),
  dead integer NOT NULL DEFAULT 0 CHECK (dead >= 0),
  stale_claim integer NOT NULL DEFAULT 0 CHECK (stale_claim >= 0),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (status = 'RUNNING' AND finished_at IS NULL AND duration_ms IS NULL)
    OR
    (status <> 'RUNNING' AND finished_at IS NOT NULL AND duration_ms IS NOT NULL)
  ),
  UNIQUE (tenant_id, run_id)
);

CREATE INDEX domain_event_tenant_execution_runs_tenant_idx
  ON platform.domain_event_tenant_execution_runs (
    tenant_id,
    started_at DESC,
    run_id
  );

CREATE INDEX domain_event_tenant_execution_runs_invocation_idx
  ON platform.domain_event_tenant_execution_runs (
    tenant_id,
    invocation_id,
    started_at DESC
  );

CREATE TABLE platform.domain_event_tenant_execution_state (
  tenant_id uuid PRIMARY KEY REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  next_scheduled_at timestamptz,
  current_run_id uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (current_run_id, tenant_id)
    REFERENCES platform.domain_event_tenant_execution_runs(run_id, tenant_id)
    ON DELETE RESTRICT,
  CHECK (
    (current_run_id IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
    OR
    (current_run_id IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX domain_event_tenant_execution_state_due_idx
  ON platform.domain_event_tenant_execution_state (
    enabled,
    next_scheduled_at
  )
  WHERE enabled = true;

ALTER TABLE platform.domain_event_tenant_execution_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.domain_event_tenant_execution_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.domain_event_tenant_execution_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.domain_event_tenant_execution_state FORCE ROW LEVEL SECURITY;

CREATE POLICY domain_event_tenant_execution_runs_tenant_all
  ON platform.domain_event_tenant_execution_runs
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY domain_event_tenant_execution_state_tenant_all
  ON platform.domain_event_tenant_execution_state
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
