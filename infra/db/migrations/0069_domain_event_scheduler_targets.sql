BEGIN;

-- Trusted control-plane registry for Domain Event scheduling coverage.
-- This table intentionally contains only scheduling authorization/metadata.
-- It is NOT a tenant business-data table and is NOT a work queue.
CREATE TABLE platform.domain_event_scheduler_targets (
  tenant_id uuid PRIMARY KEY REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  execution_enabled boolean NOT NULL DEFAULT false,
  cadence_seconds integer NOT NULL DEFAULT 300
    CHECK (cadence_seconds BETWEEN 60 AND 86400),
  next_scheduled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_selected_at timestamptz,
  last_invocation_id uuid,
  last_result text CHECK (
    last_result IS NULL OR last_result IN (
      'SUCCEEDED','FAILED','LEASE_LOST','SKIPPED_BUSY','SKIPPED_DISABLED'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX domain_event_scheduler_targets_due_idx
  ON platform.domain_event_scheduler_targets (
    next_scheduled_at,
    tenant_id
  )
  WHERE execution_enabled = true;

COMMENT ON TABLE platform.domain_event_scheduler_targets IS
  'Trusted control-plane scheduling targets only. The authoritative work queue remains platform.domain_event_outbox.';

COMMENT ON COLUMN platform.domain_event_scheduler_targets.execution_enabled IS
  'Explicit authorization for the control-plane coordinator to schedule this tenant.';

COMMIT;
