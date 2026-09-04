BEGIN;

-- ADR-017: Lead Management Configurations — Invariant 1.
--
-- A LeadManagementConfiguration activates one commercial interest type for an
-- organization. All behavioral keys (schema, qualification profile, workflow
-- blueprint, evidence profile, routing profile) are resolved from the
-- InterestTypeRegistry in the application layer (Invariant 1) and stored here
-- at creation time. They are immutable after creation.
--
-- Governance: changes follow the approval state machine:
--   DRAFT → PENDING_PARENT_REVIEW → ESCALATED → APPROVED → PUBLISHED
--   PUBLISHED → SUPERSEDED (when a new version is approved)
--   Invariant 2: governed changes never become effective through timeout;
--   the SLA escalates if not reviewed within review_sla_business_days.

CREATE TABLE platform.lead_management_configurations (
  config_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,

  -- Lineage: non-null when this configuration supersedes an earlier one.
  parent_config_id uuid,

  -- Relationship-type identifiers from the InterestTypeRegistry.
  interest_type text NOT NULL CHECK (interest_type IN (
    'FRANCHISEE', 'MASTER_FRANCHISEE', 'DISTRIBUTOR', 'AFFILIATE', 'LICENSEE', 'AGENT'
  )),
  opportunity_type text CHECK (opportunity_type IN (
    'SINGLE_UNIT', 'MULTI_UNIT', 'AREA_DEVELOPMENT', 'CONVERSION', 'RESALE',
    'EXCLUSIVE_DISTRIBUTOR', 'NON_EXCLUSIVE_DISTRIBUTOR', 'MASTER_DISTRIBUTOR', 'SUB_DISTRIBUTOR'
  )),

  -- Behavioral keys — locked from the registry at creation (Invariant 1).
  -- qualificationProfileKey, workflowBlueprintKey, evidenceProfileKey may be
  -- overridden within the same key domain (BOUNDED_SAME_DOMAIN).
  -- schemaKey is LOCKED (no override permitted).
  -- defaultRoutingProfileKey is OVERRIDABLE.
  schema_key text NOT NULL CHECK (btrim(schema_key) <> ''),
  qualification_profile_key text NOT NULL CHECK (btrim(qualification_profile_key) <> ''),
  workflow_blueprint_key text NOT NULL CHECK (btrim(workflow_blueprint_key) <> ''),
  evidence_profile_key text NOT NULL CHECK (btrim(evidence_profile_key) <> ''),
  default_routing_profile_key text NOT NULL CHECK (btrim(default_routing_profile_key) <> ''),

  -- Publication modes this configuration supports (e.g. HOSTED_FORM, REST_API).
  supported_publication_modes text[] NOT NULL DEFAULT '{}',

  -- SLA for parent review (Invariant 2). After this many business days the
  -- application layer escalates PENDING_PARENT_REVIEW → ESCALATED.
  review_sla_business_days integer NOT NULL DEFAULT 5
    CHECK (review_sla_business_days BETWEEN 1 AND 30),

  -- Approval state machine.
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT',
      'PENDING_PARENT_REVIEW',
      'ESCALATED',
      'APPROVED',
      'PUBLISHED',
      'SUPERSEDED',
      'EXPIRED_UNRESOLVED'
    )),

  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),

  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  submitted_for_review_at timestamptz,
  published_at timestamptz,
  expires_at timestamptz,

  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),

  -- ADR-017: one PUBLISHED or APPROVED configuration per interest type per organization.
  -- DRAFT and SUPERSEDED rows may coexist for the same type during the review cycle.
  CONSTRAINT lead_management_configurations_published_at_consistency
    CHECK (
      (status = 'PUBLISHED' AND published_at IS NOT NULL) OR
      (status <> 'PUBLISHED')
    )
);

-- Only one non-terminal configuration per interest type per organization may exist
-- at a time. SUPERSEDED rows are excluded so historical records are preserved.
CREATE UNIQUE INDEX lead_management_configurations_active_per_type_idx
  ON platform.lead_management_configurations (
    tenant_id, organization_id, interest_type, COALESCE(opportunity_type, '')
  )
  WHERE status NOT IN ('SUPERSEDED', 'EXPIRED_UNRESOLVED');

CREATE INDEX lead_management_configurations_org_idx
  ON platform.lead_management_configurations (tenant_id, organization_id);

CREATE INDEX lead_management_configurations_status_idx
  ON platform.lead_management_configurations (tenant_id, organization_id, status);

-- ── Row-level security ────────────────────────────────────────────────────────

ALTER TABLE platform.lead_management_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_management_configurations FORCE ROW LEVEL SECURITY;

CREATE POLICY lead_management_configurations_organization_all
  ON platform.lead_management_configurations FOR ALL
  USING (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  )
  WITH CHECK (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  );

-- ── Comments ──────────────────────────────────────────────────────────────────

COMMENT ON TABLE platform.lead_management_configurations IS
  'ADR-017 Invariant 1. One row per commercial interest type activation per organization. Behavioral keys are resolved from the InterestTypeRegistry at creation and are immutable. Approval follows the governed state machine (Invariant 2).';

COMMENT ON COLUMN platform.lead_management_configurations.schema_key IS
  'LOCKED — cannot be overridden. Resolved from the InterestTypeRegistry.';

COMMENT ON COLUMN platform.lead_management_configurations.qualification_profile_key IS
  'BOUNDED_SAME_DOMAIN override allowed: override must share the first two colon segments with the registry value.';

COMMENT ON COLUMN platform.lead_management_configurations.workflow_blueprint_key IS
  'BOUNDED_SAME_DOMAIN override allowed: override must share the first two colon segments with the registry value.';

COMMENT ON COLUMN platform.lead_management_configurations.evidence_profile_key IS
  'BOUNDED_SAME_DOMAIN override allowed: override must share the first two colon segments with the registry value.';

COMMENT ON COLUMN platform.lead_management_configurations.default_routing_profile_key IS
  'OVERRIDABLE — any value permitted (no domain constraint).';

COMMENT ON COLUMN platform.lead_management_configurations.review_sla_business_days IS
  'ADR-017 Invariant 2: SLA for parent review. Exceeding this triggers escalation from PENDING_PARENT_REVIEW to ESCALATED — the governed change may never become effective through timeout.';

COMMIT;
