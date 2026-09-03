BEGIN;

CREATE TABLE platform.lead_capture_routing_rules (
  routing_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  priority integer NOT NULL CHECK (priority >= 0),
  source_id uuid,
  target_subject_id text NOT NULL CHECK (btrim(target_subject_id) <> ''),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),
  FOREIGN KEY (source_id, tenant_id, organization_id)
    REFERENCES platform.lead_capture_sources(source_id, tenant_id, organization_id),
  UNIQUE (tenant_id, organization_id, priority),
  UNIQUE (routing_rule_id, tenant_id, organization_id)
);

CREATE INDEX lead_capture_routing_rules_match_idx
  ON platform.lead_capture_routing_rules
    (tenant_id, organization_id, status, priority, source_id);

CREATE TABLE platform.lead_capture_assignment_events (
  assignment_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  capture_lead_id uuid NOT NULL,
  routing_rule_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('ASSIGNED','UNASSIGNED')),
  assigned_subject_id text,
  previous_owner_subject_id text,
  reason_code text NOT NULL CHECK (btrim(reason_code) <> ''),
  explanation text NOT NULL CHECK (btrim(explanation) <> ''),
  actor_subject_id text NOT NULL CHECK (btrim(actor_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (outcome = 'ASSIGNED' AND assigned_subject_id IS NOT NULL AND btrim(assigned_subject_id) <> '')
    OR (outcome = 'UNASSIGNED' AND assigned_subject_id IS NULL)
  ),
  FOREIGN KEY (capture_lead_id, tenant_id, organization_id)
    REFERENCES platform.lead_capture_leads(capture_lead_id, tenant_id, organization_id),
  FOREIGN KEY (routing_rule_id, tenant_id, organization_id)
    REFERENCES platform.lead_capture_routing_rules(routing_rule_id, tenant_id, organization_id)
);

CREATE INDEX lead_capture_assignment_events_lead_idx
  ON platform.lead_capture_assignment_events
    (tenant_id, organization_id, capture_lead_id, created_at DESC, assignment_event_id DESC);

CREATE OR REPLACE FUNCTION platform.reject_lead_capture_assignment_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'lead capture assignment events are append-only';
END;
$$;

CREATE TRIGGER lead_capture_assignment_events_append_only
  BEFORE UPDATE OR DELETE ON platform.lead_capture_assignment_events
  FOR EACH ROW EXECUTE FUNCTION platform.reject_lead_capture_assignment_event_mutation();

CREATE OR REPLACE FUNCTION platform.subject_can_access_organization(
  p_tenant_id uuid,
  p_subject_id text,
  p_issuer text,
  p_organization_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $subject_scope$
  SELECT EXISTS (
    SELECT 1
    FROM platform.memberships membership
    WHERE membership.tenant_id = p_tenant_id
      AND membership.subject_id = p_subject_id
      AND membership.issuer IS NOT DISTINCT FROM p_issuer
      AND membership.status = 'ACTIVE'
      AND membership.valid_from <= now()
      AND (membership.valid_until IS NULL OR membership.valid_until > now())
      AND (
        (
          membership.organization_scope_mode IN ('SELF','SELF_AND_DESCENDANTS')
          AND membership.organization_id = p_organization_id
        )
        OR (
          membership.organization_scope_mode IN ('DESCENDANTS','SELF_AND_DESCENDANTS')
          AND EXISTS (
            SELECT 1
            FROM platform.organization_closure closure
            WHERE closure.tenant_id = membership.tenant_id
              AND closure.ancestor_organization_id = membership.organization_id
              AND closure.descendant_organization_id = p_organization_id
              AND closure.depth > 0
          )
        )
        OR (
          membership.organization_scope_mode = 'SELECTED'
          AND EXISTS (
            SELECT 1
            FROM platform.membership_organizations selected
            WHERE selected.membership_id = membership.membership_id
              AND selected.tenant_id = membership.tenant_id
              AND selected.organization_id = p_organization_id
          )
        )
      )
  );
$subject_scope$;

COMMENT ON FUNCTION platform.subject_can_access_organization(uuid, text, text, uuid) IS
  'RLS-safe parameterized membership predicate used to validate Demand Capture routing targets without changing current request subject context.';

ALTER TABLE platform.lead_capture_routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_capture_routing_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_capture_assignment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_capture_assignment_events FORCE ROW LEVEL SECURITY;

CREATE POLICY lead_capture_routing_rules_organization_all
  ON platform.lead_capture_routing_rules
  FOR ALL
  USING (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  )
  WITH CHECK (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  );

CREATE POLICY lead_capture_assignment_events_organization_select
  ON platform.lead_capture_assignment_events
  FOR SELECT
  USING (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  );

CREATE POLICY lead_capture_assignment_events_organization_insert
  ON platform.lead_capture_assignment_events
  FOR INSERT
  WITH CHECK (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  );

COMMENT ON TABLE platform.lead_capture_routing_rules IS
  'Deterministic organization-scoped Demand Capture routing rules. Lower priority number wins; optional source_id narrows a rule to one trusted capture source.';
COMMENT ON TABLE platform.lead_capture_assignment_events IS
  'Append-only Demand Capture routing outcomes. UNASSIGNED is an explicit auditable result, never a silent discard.';

COMMIT;
