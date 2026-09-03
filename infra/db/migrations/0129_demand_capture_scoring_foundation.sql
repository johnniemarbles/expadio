BEGIN;

CREATE TABLE platform.lead_qualification_templates (
  qualification_template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  template_key text NOT NULL CHECK (btrim(template_key) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  version integer NOT NULL CHECK (version > 0),
  criteria jsonb NOT NULL CHECK (jsonb_typeof(criteria) = 'array'),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  activated_at timestamptz,
  retired_at timestamptz,
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),
  UNIQUE (tenant_id, organization_id, template_key, version),
  UNIQUE (qualification_template_id, tenant_id, organization_id)
);

CREATE UNIQUE INDEX lead_qualification_templates_one_active_idx
  ON platform.lead_qualification_templates (tenant_id, organization_id, template_key)
  WHERE status = 'ACTIVE';

CREATE TABLE platform.lead_qualifications (
  qualification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  capture_lead_id uuid NOT NULL,
  qualification_template_id uuid NOT NULL,
  template_version integer NOT NULL CHECK (template_version > 0),
  criterion_key text NOT NULL CHECK (btrim(criterion_key) <> ''),
  response text NOT NULL CHECK (response IN (
    'NOT_ASSESSED','MEETS','PARTIALLY_MEETS','DOES_NOT_MEET','NOT_APPLICABLE'
  )),
  note text,
  assessed_by_subject_id text NOT NULL CHECK (btrim(assessed_by_subject_id) <> ''),
  assessed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (capture_lead_id, tenant_id, organization_id)
    REFERENCES platform.lead_capture_leads(capture_lead_id, tenant_id, organization_id),
  FOREIGN KEY (qualification_template_id, tenant_id, organization_id)
    REFERENCES platform.lead_qualification_templates(qualification_template_id, tenant_id, organization_id)
);

CREATE INDEX lead_qualifications_lead_idx
  ON platform.lead_qualifications
    (tenant_id, organization_id, capture_lead_id, assessed_at DESC);

CREATE TABLE platform.lead_scoring_profiles (
  scoring_profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  profile_key text NOT NULL CHECK (btrim(profile_key) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  version integer NOT NULL CHECK (version > 0),
  components jsonb NOT NULL CHECK (jsonb_typeof(components) = 'array'),
  band_thresholds jsonb NOT NULL CHECK (jsonb_typeof(band_thresholds) = 'object'),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  activated_at timestamptz,
  retired_at timestamptz,
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),
  UNIQUE (tenant_id, organization_id, profile_key, version),
  UNIQUE (scoring_profile_id, tenant_id, organization_id)
);

CREATE UNIQUE INDEX lead_scoring_profiles_one_active_idx
  ON platform.lead_scoring_profiles (tenant_id, organization_id, profile_key)
  WHERE status = 'ACTIVE';

CREATE TABLE platform.lead_scores (
  score_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  capture_lead_id uuid NOT NULL,
  scoring_profile_id uuid NOT NULL,
  profile_version integer NOT NULL CHECK (profile_version > 0),
  total_score numeric(12,4) NOT NULL,
  band text NOT NULL CHECK (btrim(band) <> ''),
  calculated_by_subject_id text NOT NULL CHECK (btrim(calculated_by_subject_id) <> ''),
  calculation_reason text NOT NULL CHECK (btrim(calculation_reason) <> ''),
  calculated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (capture_lead_id, tenant_id, organization_id)
    REFERENCES platform.lead_capture_leads(capture_lead_id, tenant_id, organization_id),
  FOREIGN KEY (scoring_profile_id, tenant_id, organization_id)
    REFERENCES platform.lead_scoring_profiles(scoring_profile_id, tenant_id, organization_id),
  UNIQUE (score_id, tenant_id, organization_id)
);

CREATE INDEX lead_scores_current_lookup_idx
  ON platform.lead_scores
    (tenant_id, organization_id, capture_lead_id, calculated_at DESC, score_id DESC);

CREATE TABLE platform.lead_score_components (
  score_component_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  score_id uuid NOT NULL,
  component_key text NOT NULL CHECK (btrim(component_key) <> ''),
  raw_value jsonb NOT NULL,
  weight numeric(12,4) NOT NULL,
  points_awarded numeric(12,4) NOT NULL,
  points_possible numeric(12,4) NOT NULL CHECK (points_possible >= 0),
  explanation text NOT NULL CHECK (btrim(explanation) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (score_id, tenant_id, organization_id)
    REFERENCES platform.lead_scores(score_id, tenant_id, organization_id),
  UNIQUE (score_id, component_key)
);

CREATE OR REPLACE FUNCTION platform.reject_lead_scoring_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'lead scoring evidence is append-only';
END;
$$;

CREATE TRIGGER lead_qualifications_append_only
  BEFORE UPDATE OR DELETE ON platform.lead_qualifications
  FOR EACH ROW EXECUTE FUNCTION platform.reject_lead_scoring_evidence_mutation();
CREATE TRIGGER lead_scores_append_only
  BEFORE UPDATE OR DELETE ON platform.lead_scores
  FOR EACH ROW EXECUTE FUNCTION platform.reject_lead_scoring_evidence_mutation();
CREATE TRIGGER lead_score_components_append_only
  BEFORE UPDATE OR DELETE ON platform.lead_score_components
  FOR EACH ROW EXECUTE FUNCTION platform.reject_lead_scoring_evidence_mutation();

ALTER TABLE platform.lead_qualification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_qualification_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_qualifications FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_scoring_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_scoring_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_scores FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_score_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_score_components FORCE ROW LEVEL SECURITY;

CREATE POLICY lead_qualification_templates_organization_all
  ON platform.lead_qualification_templates FOR ALL
  USING (tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id))
  WITH CHECK (tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id));

CREATE POLICY lead_qualifications_organization_select
  ON platform.lead_qualifications FOR SELECT
  USING (tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id));
CREATE POLICY lead_qualifications_organization_insert
  ON platform.lead_qualifications FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id));

CREATE POLICY lead_scoring_profiles_organization_all
  ON platform.lead_scoring_profiles FOR ALL
  USING (tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id))
  WITH CHECK (tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id));

CREATE POLICY lead_scores_organization_select
  ON platform.lead_scores FOR SELECT
  USING (tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id));
CREATE POLICY lead_scores_organization_insert
  ON platform.lead_scores FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id));

CREATE POLICY lead_score_components_organization_select
  ON platform.lead_score_components FOR SELECT
  USING (tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id));
CREATE POLICY lead_score_components_organization_insert
  ON platform.lead_score_components FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id));

COMMENT ON TABLE platform.lead_qualification_templates IS
  'Versioned organization-scoped Demand Capture qualification criteria. Template lifecycle is configuration; assessments remain immutable evidence.';
COMMENT ON TABLE platform.lead_qualifications IS
  'Append-only qualification assessments for authoritative 19-stage Demand Capture leads.';
COMMENT ON TABLE platform.lead_scoring_profiles IS
  'Versioned deterministic scoring configuration. Profile JSON describes components and bands but never authorizes access.';
COMMENT ON TABLE platform.lead_scores IS
  'Immutable Demand Capture score snapshots. Current score is the latest snapshot, not a mutable client-controlled flag.';
COMMENT ON TABLE platform.lead_score_components IS
  'Immutable component-level evidence explaining every persisted score snapshot.';

COMMIT;
