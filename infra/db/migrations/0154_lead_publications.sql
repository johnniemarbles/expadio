BEGIN;

-- ADR-017: Publication layer — Invariant 4.
--
-- Publication is DISTINCT from Capture Configuration and Capture Source.
--
--   - A Capture Configuration may produce many Publications.
--   - Each Publication represents one independently attributable channel.
--   - Each Publication owns exactly one Capture Source.
--   - A Capture Source may NOT be shared across Publications.
--
-- Hosted-form URL shape: apply.<brand>.com/opportunity
--   publication_slug stores the brand-configured path (e.g. '/opportunity', '/join').
--   The slug must be interest-type-neutral — no '/franchise', '/distributor', etc.
--   Interest type is selected inside the form, not encoded in the URL path.
--   The application layer enforces slug neutrality; the DB constraint enforces format only.

CREATE TABLE platform.lead_publications (
  publication_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  capture_config_id uuid NOT NULL,

  -- Interest type: copied from the Capture Configuration at publish time.
  -- These are the relationship-type identifiers (FRANCHISEE, DISTRIBUTOR, etc.),
  -- not URL path segments.
  interest_type text NOT NULL CHECK (interest_type IN (
    'FRANCHISEE', 'MASTER_FRANCHISEE', 'DISTRIBUTOR', 'AFFILIATE', 'LICENSEE', 'AGENT'
  )),
  opportunity_type text CHECK (opportunity_type IN (
    'SINGLE_UNIT', 'MULTI_UNIT', 'AREA_DEVELOPMENT', 'CONVERSION', 'RESALE',
    'EXCLUSIVE_DISTRIBUTOR', 'NON_EXCLUSIVE_DISTRIBUTOR', 'MASTER_DISTRIBUTOR', 'SUB_DISTRIBUTOR'
  )),

  -- Behavioral keys: copied from the Effective Configuration at publish time.
  -- These are immutable on a Publication; a new Publication must be created for changes.
  schema_key text NOT NULL CHECK (btrim(schema_key) <> ''),
  qualification_profile_key text NOT NULL CHECK (btrim(qualification_profile_key) <> ''),
  workflow_blueprint_key text NOT NULL CHECK (btrim(workflow_blueprint_key) <> ''),
  evidence_profile_key text NOT NULL CHECK (btrim(evidence_profile_key) <> ''),
  default_routing_profile_key text NOT NULL CHECK (btrim(default_routing_profile_key) <> ''),

  publication_mode text NOT NULL CHECK (publication_mode IN (
    'HOSTED_FORM', 'JS_WIDGET', 'IFRAME', 'REST_API', 'SIGNED_WEBHOOK',
    'EMAIL_LINK', 'SOCIAL_LINK', 'WHATSAPP_SMS_LINK', 'QR_CODE'
  )),

  -- Hosted-form configuration. Non-null only when publication_mode = 'HOSTED_FORM'.
  -- The application layer validates that the slug is interest-type-neutral.
  publication_slug text CHECK (
    publication_slug IS NULL OR
    (publication_slug ~ '^/[a-z0-9-]+(/[a-z0-9-]+)*$')
  ),
  brand_domain text CHECK (
    brand_domain IS NULL OR btrim(brand_domain) <> ''
  ),
  post_submit_redirect_url text,
  enable_pre_fill boolean,

  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED')),

  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  activated_at timestamptz,
  archived_at timestamptz,

  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),

  -- publication_slug + brand_domain required together when mode is HOSTED_FORM.
  -- Enforced more precisely at the application layer; this guards against null.
  CONSTRAINT lead_publication_hosted_form_config_consistency
    CHECK (
      (publication_mode = 'HOSTED_FORM' AND publication_slug IS NOT NULL AND brand_domain IS NOT NULL)
      OR (publication_mode <> 'HOSTED_FORM' AND publication_slug IS NULL AND brand_domain IS NULL)
    ),

  CONSTRAINT lead_publication_activated_at_consistency
    CHECK (
      (status = 'ACTIVE' AND activated_at IS NOT NULL) OR
      (status <> 'ACTIVE')
    ),

  CONSTRAINT lead_publication_archived_at_consistency
    CHECK (
      (status = 'ARCHIVED' AND archived_at IS NOT NULL) OR
      (status <> 'ARCHIVED')
    )
);

-- One ACTIVE publication per (organization, capture_config_id, interest_type, opportunity_type).
-- Prevents accidentally having two live publications for the same product.
CREATE UNIQUE INDEX lead_publications_one_active_per_config_type_idx
  ON platform.lead_publications (
    tenant_id, organization_id, capture_config_id, interest_type,
    COALESCE(opportunity_type, '')
  )
  WHERE status = 'ACTIVE';

CREATE INDEX lead_publications_config_idx
  ON platform.lead_publications (tenant_id, organization_id, capture_config_id);

CREATE INDEX lead_publications_status_idx
  ON platform.lead_publications (tenant_id, organization_id, status);

-- ── Publication Sources ───────────────────────────────────────────────────────
--
-- A Publication Source is the attribution anchor for a Publication.
-- One source per publication, never shared. Created atomically with the Publication.
--
-- Named lead_publication_sources to distinguish from the pre-ADR-017
-- platform.lead_capture_sources table (migration 0125, source_key/surface model).

CREATE TABLE platform.lead_publication_sources (
  capture_source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  -- Human-readable label for the channel (e.g. "Website /opportunity", "Google Ads Canada").
  label text NOT NULL CHECK (btrim(label) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),

  -- ADR-017 Invariant 4: capture_source_id is unique to this publication.
  -- A source may never be transferred to another publication.
  UNIQUE (publication_id),
  UNIQUE (capture_source_id, tenant_id, organization_id)
);

CREATE INDEX lead_publication_sources_publication_idx
  ON platform.lead_publication_sources (tenant_id, organization_id, publication_id);

-- ── Row-level security ───────────────────────────────────────────────────────

ALTER TABLE platform.lead_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_publications FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_publication_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_publication_sources FORCE ROW LEVEL SECURITY;

CREATE POLICY lead_publications_organization_all
  ON platform.lead_publications FOR ALL
  USING (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  )
  WITH CHECK (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  );

CREATE POLICY lead_publication_sources_organization_all
  ON platform.lead_publication_sources FOR ALL
  USING (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  )
  WITH CHECK (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  );

-- ── Comments ─────────────────────────────────────────────────────────────────

COMMENT ON TABLE platform.lead_publications IS
  'ADR-017 Publication layer. Each publication is one independently attributable channel derived from a Capture Configuration. Behavioral keys are copied at publish time and immutable thereafter.';

COMMENT ON TABLE platform.lead_publication_sources IS
  'Attribution anchors for Publications (ADR-017). One source per publication (UNIQUE on publication_id), never shared. Created atomically with the publication; capture_source_id is stored on every lead submission for per-channel analytics. Distinct from the pre-ADR-017 platform.lead_capture_sources table (migration 0125).';

COMMENT ON COLUMN platform.lead_publications.publication_slug IS
  'Brand-configured URL path for HOSTED_FORM publications (e.g. /opportunity, /join). Must be interest-type-neutral — the application layer rejects /franchise, /distributor, etc. The full URL is https://<brand_domain><publication_slug>.';

COMMENT ON COLUMN platform.lead_publications.interest_type IS
  'Relationship-type identifier (FRANCHISEE, DISTRIBUTOR, etc.) — not a URL path segment. Interest type selection occurs inside the hosted form, not in the URL.';

COMMIT;
