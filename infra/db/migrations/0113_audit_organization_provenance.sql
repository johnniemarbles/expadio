BEGIN;

-- Forward-only organization provenance for audit/history surfaces.
-- Existing rows are intentionally NOT backfilled: assigning historical rows to
-- an organization without recorded evidence would fabricate provenance.
ALTER TABLE platform.agent_runs
  ADD COLUMN organization_id uuid
  REFERENCES platform.organizations(organization_id) ON DELETE SET NULL;

ALTER TABLE platform.agent_run_events
  ADD COLUMN organization_id uuid
  REFERENCES platform.organizations(organization_id) ON DELETE SET NULL;

ALTER TABLE platform.sensitive_read_events
  ADD COLUMN organization_id uuid
  REFERENCES platform.organizations(organization_id) ON DELETE SET NULL;

CREATE INDEX agent_runs_tenant_org_created_idx
  ON platform.agent_runs (tenant_id, organization_id, created_at DESC, run_id);

CREATE INDEX agent_run_events_tenant_org_time_idx
  ON platform.agent_run_events (tenant_id, organization_id, occurred_at DESC, event_id);

CREATE INDEX sensitive_read_events_tenant_org_time_idx
  ON platform.sensitive_read_events (tenant_id, organization_id, recorded_at DESC, event_id);

COMMIT;
