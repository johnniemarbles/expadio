BEGIN;

-- ADR-017: Evidence / compliance model.
--
-- An EvidenceProfile declares, per qualification criterion, the minimum
-- provenance level required for the scoring engine's verified-score mode.
-- Referenced by LeadManagementConfiguration.evidenceProfileKey
-- (BOUNDED_SAME_DOMAIN key; domain = first two colon-segments of profile_key,
-- e.g. 'evidence:franchise').
--
-- Profiles are versioned configuration; requirements are append-only once a
-- profile reaches ACTIVE status (enforced at the application layer).

CREATE TABLE platform.lead_evidence_profiles (
  evidence_profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  profile_key text NOT NULL CHECK (
    btrim(profile_key) <> '' AND
    profile_key ~ '^evidence:[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$'
  ),
  name text NOT NULL CHECK (btrim(name) <> ''),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  activated_at timestamptz,
  retired_at timestamptz,
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),
  UNIQUE (tenant_id, organization_id, profile_key, version),
  UNIQUE (evidence_profile_id, tenant_id, organization_id),
  -- activated_at must be set when status is ACTIVE, and unset when DRAFT.
  CONSTRAINT lead_evidence_profile_activated_at_consistency
    CHECK (
      (status = 'ACTIVE' AND activated_at IS NOT NULL) OR
      (status != 'ACTIVE')
    )
);

-- Only one ACTIVE version of a profile key per organization at a time.
CREATE UNIQUE INDEX lead_evidence_profiles_one_active_idx
  ON platform.lead_evidence_profiles (tenant_id, organization_id, profile_key)
  WHERE status = 'ACTIVE';

CREATE TABLE platform.lead_evidence_requirements (
  requirement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  evidence_profile_id uuid NOT NULL,
  criterion_key text NOT NULL CHECK (btrim(criterion_key) <> ''),
  minimum_provenance_level text NOT NULL CHECK (minimum_provenance_level IN (
    'SELF_DECLARED',
    'SYSTEM_DERIVED',
    'OPERATOR_ASSESSED',
    'DOCUMENT_VERIFIED',
    'EXTERNAL_VERIFIED'
  )),
  mode text NOT NULL CHECK (mode IN ('REQUIRED','CONDITIONAL','OPTIONAL')),
  blocks_verified_score boolean NOT NULL DEFAULT false,
  FOREIGN KEY (evidence_profile_id, tenant_id, organization_id)
    REFERENCES platform.lead_evidence_profiles(evidence_profile_id, tenant_id, organization_id)
      ON DELETE RESTRICT,
  -- Each criterion appears at most once per profile version.
  UNIQUE (evidence_profile_id, criterion_key)
);

CREATE INDEX lead_evidence_requirements_profile_idx
  ON platform.lead_evidence_requirements (tenant_id, organization_id, evidence_profile_id);

ALTER TABLE platform.lead_evidence_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_evidence_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_evidence_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_evidence_requirements FORCE ROW LEVEL SECURITY;

CREATE POLICY lead_evidence_profiles_organization_all
  ON platform.lead_evidence_profiles FOR ALL
  USING (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  )
  WITH CHECK (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  );

CREATE POLICY lead_evidence_requirements_organization_all
  ON platform.lead_evidence_requirements FOR ALL
  USING (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  )
  WITH CHECK (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  );

COMMENT ON TABLE platform.lead_evidence_profiles IS
  'Versioned evidence profiles declaring per-criterion minimum provenance levels for verified scoring. Referenced by LeadManagementConfiguration.evidence_profile_key (BOUNDED_SAME_DOMAIN).';
COMMENT ON TABLE platform.lead_evidence_requirements IS
  'Per-criterion evidence requirements within a profile: minimum provenance level, requirement mode (REQUIRED/CONDITIONAL/OPTIONAL), and whether an unmet requirement blocks the verified score.';
COMMENT ON COLUMN platform.lead_evidence_requirements.minimum_provenance_level IS
  'Weakest evidence source that qualifies for the verified score on this criterion. ADR-017 provenance order: SELF_DECLARED < SYSTEM_DERIVED < OPERATOR_ASSESSED < DOCUMENT_VERIFIED < EXTERNAL_VERIFIED.';
COMMENT ON COLUMN platform.lead_evidence_requirements.blocks_verified_score IS
  'When true and the criterion has no qualifying fact, the verified score cannot be produced. Always true for REQUIRED criteria that must gate scoring; may be true for OPTIONAL criteria that protect compliance fields.';

COMMIT;
