BEGIN;

-- Forward-only organization provenance for immutable audit/history rows.
-- Existing rows are intentionally NOT backfilled: assigning historical rows
-- to an organization without recorded evidence would fabricate provenance.
ALTER TABLE platform.agent_runs
  ADD COLUMN organization_id uuid;

ALTER TABLE platform.agent_run_events
  ADD COLUMN organization_id uuid;

ALTER TABLE platform.sensitive_read_events
  ADD COLUMN organization_id uuid;

ALTER TABLE platform.agent_runs
  ADD CONSTRAINT agent_runs_organization_tenant_fk
  FOREIGN KEY (organization_id, tenant_id)
  REFERENCES platform.organizations(organization_id, tenant_id);

ALTER TABLE platform.agent_run_events
  ADD CONSTRAINT agent_run_events_organization_tenant_fk
  FOREIGN KEY (organization_id, tenant_id)
  REFERENCES platform.organizations(organization_id, tenant_id);

ALTER TABLE platform.sensitive_read_events
  ADD CONSTRAINT sensitive_read_events_organization_tenant_fk
  FOREIGN KEY (organization_id, tenant_id)
  REFERENCES platform.organizations(organization_id, tenant_id);

ALTER TABLE platform.agent_runs
  ADD CONSTRAINT agent_runs_organization_required
  CHECK (organization_id IS NOT NULL) NOT VALID;

ALTER TABLE platform.agent_run_events
  ADD CONSTRAINT agent_run_events_organization_required
  CHECK (organization_id IS NOT NULL) NOT VALID;

ALTER TABLE platform.sensitive_read_events
  ADD CONSTRAINT sensitive_read_events_organization_required
  CHECK (organization_id IS NOT NULL) NOT VALID;

CREATE OR REPLACE FUNCTION platform.current_organization_id_nullable()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid
$$;

ALTER TABLE platform.agent_runs
  ALTER COLUMN organization_id
  SET DEFAULT platform.current_organization_id_nullable();

ALTER TABLE platform.sensitive_read_events
  ALTER COLUMN organization_id
  SET DEFAULT platform.current_organization_id_nullable();

CREATE OR REPLACE FUNCTION platform.bind_agent_run_event_organization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_organization uuid;
  ambient_organization uuid;
BEGIN
  SELECT organization_id
    INTO parent_organization
    FROM platform.agent_runs
   WHERE run_id = NEW.run_id
     AND tenant_id = NEW.tenant_id;

  ambient_organization := platform.current_organization_id_nullable();

  IF parent_organization IS NOT NULL
     AND ambient_organization IS NOT NULL
     AND parent_organization <> ambient_organization THEN
    RAISE EXCEPTION
      'Agent run event organization conflicts with parent run';
  END IF;

  NEW.organization_id := parent_organization;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_run_events_bind_organization
BEFORE INSERT ON platform.agent_run_events
FOR EACH ROW EXECUTE FUNCTION platform.bind_agent_run_event_organization();

CREATE INDEX agent_runs_tenant_org_created_idx
  ON platform.agent_runs (tenant_id, organization_id, created_at DESC, run_id);

CREATE INDEX agent_run_events_tenant_org_time_idx
  ON platform.agent_run_events (tenant_id, organization_id, occurred_at DESC, event_id);

CREATE INDEX sensitive_read_events_tenant_org_time_idx
  ON platform.sensitive_read_events (tenant_id, organization_id, recorded_at DESC, event_id);

DROP POLICY IF EXISTS agent_runs_select ON platform.agent_runs;
DROP POLICY IF EXISTS agent_runs_insert ON platform.agent_runs;
DROP POLICY IF EXISTS agent_run_events_select ON platform.agent_run_events;
DROP POLICY IF EXISTS agent_run_events_insert ON platform.agent_run_events;
DROP POLICY IF EXISTS sensitive_read_events_select ON platform.sensitive_read_events;
DROP POLICY IF EXISTS sensitive_read_events_insert ON platform.sensitive_read_events;

CREATE POLICY agent_runs_select
  ON platform.agent_runs
  FOR SELECT
  USING (
    tenant_id = platform.current_tenant_id()
    AND organization_id = platform.current_organization_id_nullable()
  );

CREATE POLICY agent_runs_insert
  ON platform.agent_runs
  FOR INSERT
  WITH CHECK (
    tenant_id = platform.current_tenant_id()
    AND organization_id = platform.current_organization_id_nullable()
  );

CREATE POLICY agent_run_events_select
  ON platform.agent_run_events
  FOR SELECT
  USING (
    tenant_id = platform.current_tenant_id()
    AND organization_id = platform.current_organization_id_nullable()
  );

CREATE POLICY agent_run_events_insert
  ON platform.agent_run_events
  FOR INSERT
  WITH CHECK (
    tenant_id = platform.current_tenant_id()
    AND organization_id = platform.current_organization_id_nullable()
  );

CREATE POLICY sensitive_read_events_select
  ON platform.sensitive_read_events
  FOR SELECT
  USING (
    tenant_id = platform.current_tenant_id()
    AND organization_id = platform.current_organization_id_nullable()
  );

CREATE POLICY sensitive_read_events_insert
  ON platform.sensitive_read_events
  FOR INSERT
  WITH CHECK (
    tenant_id = platform.current_tenant_id()
    AND organization_id = platform.current_organization_id_nullable()
  );

COMMIT;
