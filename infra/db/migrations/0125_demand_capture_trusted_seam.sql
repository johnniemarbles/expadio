BEGIN;

-- Trusted Demand Capture seam.
--
-- Capture provenance is persisted server-side before projection into the thin
-- five-stage CRM. EXPADIO organization scope remains the authorization boundary;
-- capture layer/source metadata is provenance only and never grants access.

CREATE TABLE platform.lead_capture_sources (
  source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  source_key text NOT NULL CHECK (btrim(source_key) <> ''),
  surface text NOT NULL CHECK (btrim(surface) <> ''),
  layer_key text,
  require_signed_ticket boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),
  UNIQUE (tenant_id, source_key),
  UNIQUE (source_id, tenant_id, organization_id)
);

CREATE INDEX lead_capture_sources_scope_idx
  ON platform.lead_capture_sources (tenant_id, organization_id, status, source_key);

CREATE TABLE platform.lead_capture_leads (
  capture_lead_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  source_id uuid NOT NULL,
  external_reference text,
  title text CHECK (title IS NULL OR length(btrim(title)) BETWEEN 1 AND 200),
  email text,
  stage text NOT NULL DEFAULT 'NEW_ENQUIRY' CHECK (stage IN (
    'NEW_ENQUIRY','CONTACT_ATTEMPTED','CONTACTED','QUALIFICATION','QUALIFIED',
    'DISCOVERY_SCHEDULED','DISCOVERY_COMPLETED','OPPORTUNITY_EVALUATION',
    'APPLICATION_INVITED','APPLICATION_STARTED','APPLICATION_SUBMITTED',
    'DUE_DILIGENCE','APPROVAL','AGREEMENT','ACTIVATION','WON','LOST',
    'DISQUALIFIED','NURTURE'
  )),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN (
    'ACTIVE','WAITING_ON_LEAD','WAITING_INTERNAL','ON_HOLD','STALLED',
    'DISQUALIFIED','CONVERTED','LOST','ARCHIVED'
  )),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_payload) = 'object'),
  owner_subject_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),
  FOREIGN KEY (source_id, tenant_id, organization_id)
    REFERENCES platform.lead_capture_sources(source_id, tenant_id, organization_id),
  UNIQUE (capture_lead_id, tenant_id, organization_id)
);

CREATE UNIQUE INDEX lead_capture_leads_external_ref_uq
  ON platform.lead_capture_leads (tenant_id, source_id, external_reference)
  WHERE external_reference IS NOT NULL;
CREATE INDEX lead_capture_leads_scope_stage_idx
  ON platform.lead_capture_leads (tenant_id, organization_id, stage, created_at DESC);

CREATE TABLE platform.lead_capture_submissions (
  submission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  source_id uuid NOT NULL,
  capture_lead_id uuid,
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  raw_payload jsonb NOT NULL CHECK (jsonb_typeof(raw_payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),
  FOREIGN KEY (source_id, tenant_id, organization_id)
    REFERENCES platform.lead_capture_sources(source_id, tenant_id, organization_id),
  FOREIGN KEY (capture_lead_id, tenant_id, organization_id)
    REFERENCES platform.lead_capture_leads(capture_lead_id, tenant_id, organization_id),
  UNIQUE (tenant_id, source_id, idempotency_key)
);

CREATE INDEX lead_capture_submissions_scope_created_idx
  ON platform.lead_capture_submissions (tenant_id, organization_id, created_at DESC);

CREATE OR REPLACE FUNCTION platform.deny_lead_capture_submission_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'lead_capture_submissions is append-only';
END;
$$;

CREATE TRIGGER lead_capture_submissions_append_only
  BEFORE UPDATE OR DELETE ON platform.lead_capture_submissions
  FOR EACH ROW EXECUTE FUNCTION platform.deny_lead_capture_submission_mutation();

ALTER TABLE platform.lead_capture_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_capture_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_capture_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_capture_leads FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_capture_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_capture_submissions FORCE ROW LEVEL SECURITY;

CREATE POLICY lead_capture_sources_organization_isolation
  ON platform.lead_capture_sources
  FOR ALL
  USING (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  )
  WITH CHECK (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  );

CREATE POLICY lead_capture_leads_organization_isolation
  ON platform.lead_capture_leads
  FOR ALL
  USING (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  )
  WITH CHECK (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  );

CREATE POLICY lead_capture_submissions_organization_isolation
  ON platform.lead_capture_submissions
  FOR ALL
  USING (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  )
  WITH CHECK (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  );

COMMENT ON TABLE platform.lead_capture_sources IS
  'Trusted server-side registry for Demand Capture source provenance. Source/layer metadata never grants authorization.';
COMMENT ON TABLE platform.lead_capture_leads IS
  'Authoritative 19-stage Demand Capture records. CRM projection must load this row rather than trusting request stage/payload.';
COMMENT ON TABLE platform.lead_capture_submissions IS
  'Append-only raw Demand Capture submissions with per-source idempotency.';

COMMIT;
