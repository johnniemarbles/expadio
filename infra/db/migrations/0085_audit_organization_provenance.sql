BEGIN;

-- No default while adding columns: existing immutable history stays unassigned.
ALTER TABLE platform.agent_runs ADD COLUMN organization_id uuid;
ALTER TABLE platform.agent_run_events ADD COLUMN organization_id uuid;
ALTER TABLE platform.sensitive_read_events ADD COLUMN organization_id uuid;

ALTER TABLE platform.agent_runs
  ADD CONSTRAINT agent_runs_organization_fk FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),
  ADD CONSTRAINT agent_runs_scoped_identity UNIQUE (run_id, tenant_id, organization_id),
  ADD CONSTRAINT agent_runs_new_organization_required CHECK (organization_id IS NOT NULL) NOT VALID;
ALTER TABLE platform.agent_run_events
  ADD CONSTRAINT agent_run_events_organization_fk FOREIGN KEY (run_id, tenant_id, organization_id)
    REFERENCES platform.agent_runs(run_id, tenant_id, organization_id),
  ADD CONSTRAINT agent_run_events_new_organization_required CHECK (organization_id IS NOT NULL) NOT VALID;
ALTER TABLE platform.sensitive_read_events
  ADD CONSTRAINT sensitive_read_events_organization_fk FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),
  ADD CONSTRAINT sensitive_read_events_new_organization_required CHECK (organization_id IS NOT NULL) NOT VALID;

-- Only subsequent inserts may obtain scope from a verified transaction.
ALTER TABLE platform.agent_runs ALTER COLUMN organization_id SET DEFAULT platform.current_organization_id();
ALTER TABLE platform.agent_run_events ALTER COLUMN organization_id SET DEFAULT platform.current_organization_id();
ALTER TABLE platform.sensitive_read_events ALTER COLUMN organization_id SET DEFAULT platform.current_organization_id();

-- Restrictive policies compose with the existing tenant policies (AND, not OR).
CREATE POLICY agent_runs_organization_isolation ON platform.agent_runs AS RESTRICTIVE
  FOR ALL USING (organization_id = platform.current_organization_id())
  WITH CHECK (organization_id = platform.current_organization_id());
CREATE POLICY agent_run_events_organization_isolation ON platform.agent_run_events AS RESTRICTIVE
  FOR ALL USING (organization_id = platform.current_organization_id())
  WITH CHECK (organization_id = platform.current_organization_id());
CREATE POLICY sensitive_read_events_organization_isolation ON platform.sensitive_read_events AS RESTRICTIVE
  FOR ALL USING (organization_id = platform.current_organization_id())
  WITH CHECK (organization_id = platform.current_organization_id());

CREATE INDEX agent_run_events_scope_time_idx ON platform.agent_run_events (tenant_id, organization_id, occurred_at DESC);
CREATE INDEX sensitive_read_events_scope_time_idx ON platform.sensitive_read_events (tenant_id, organization_id, recorded_at DESC);

-- Existing explicit admin roles may request platform scope; subject/tenant/org,
-- restrictions and resource bounds are still evaluated by canonical policy.
INSERT INTO platform.authorization_role_capabilities (role_id, action, resource_type)
SELECT role_id, 'platform.scope.use', 'platform'
FROM platform.authorization_roles
WHERE ownership_scope = 'PLATFORM' AND role_key IN ('PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN')
ON CONFLICT (role_id, action, resource_type) DO NOTHING;

-- Audit access is an explicit collection capability. No new memberships,
-- assignments, or clearance grants are created by this migration.
INSERT INTO platform.authorization_role_capabilities (role_id, action, resource_type)
SELECT role_id, 'audit.activity.read', 'audit-activity'
FROM platform.authorization_roles
WHERE role_key IN ('PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN', 'TENANT_OWNER', 'TENANT_ADMIN', 'AUDITOR')
ON CONFLICT (role_id, action, resource_type) DO NOTHING;

COMMIT;
