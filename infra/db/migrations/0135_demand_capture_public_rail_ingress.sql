BEGIN;

-- PUBLIC (Rail B) Demand Capture ingress.
--
-- The signed rail (0126) authenticates the sender by Ed25519 and admits them
-- straight into the pipeline. The PUBLIC rail cannot: a browser holds no secret,
-- and its Origin can be spoofed by a non-browser client. So the security model is
-- layered — publishable key + origin allowlist + rate limits keep out casual
-- abuse, and an OTP gate keeps UNVERIFIED submissions OUT of the pipeline while
-- still capturing them (capture-first: an abandoned enquiry is never discarded).
--
-- Like the signed rail, tenant/source are routing coordinates carried in the URL,
-- never authorization claims; organization scope comes from the source row.

-- 1. Verification state on capture leads. Signed-rail leads are pre-trusted
--    (NOT_REQUIRED); public-rail leads start UNVERIFIED and are promoted to
--    VERIFIED only by a passed OTP challenge. Routing/scoring must ignore
--    UNVERIFIED leads (enforced in the pipeline, not here).
ALTER TABLE platform.lead_capture_leads
  ADD COLUMN verification_state text NOT NULL DEFAULT 'NOT_REQUIRED'
    CHECK (verification_state IN ('NOT_REQUIRED','UNVERIFIED','VERIFIED'));

CREATE INDEX lead_capture_leads_verification_state_idx
  ON platform.lead_capture_leads (tenant_id, organization_id, verification_state, created_at DESC);

-- 2. OTP challenges. Codes are stored ONLY as a salted hash; the plaintext is
--    delivered out of band (Communications) and never persisted or logged.
CREATE TABLE platform.lead_capture_verifications (
  verification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  source_id uuid NOT NULL,
  capture_lead_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('EMAIL','SMS')),
  destination_hash text NOT NULL CHECK (btrim(destination_hash) <> ''),
  code_hash text NOT NULL CHECK (btrim(code_hash) <> ''),
  code_salt text NOT NULL CHECK (btrim(code_salt) <> ''),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  resends integer NOT NULL DEFAULT 0 CHECK (resends >= 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VERIFIED','EXPIRED','LOCKED')),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),
  FOREIGN KEY (capture_lead_id, tenant_id, organization_id)
    REFERENCES platform.lead_capture_leads(capture_lead_id, tenant_id, organization_id)
);

CREATE INDEX lead_capture_verifications_lead_idx
  ON platform.lead_capture_verifications (tenant_id, organization_id, capture_lead_id, status);

-- 3. Rate events. Append-only signal used to throttle a PUBLIC source by IP and
--    by contact within a rolling window. Hashes only — no raw IP or email.
CREATE TABLE platform.lead_capture_rate_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  source_id uuid NOT NULL,
  dimension text NOT NULL CHECK (dimension IN ('IP','EMAIL')),
  key_hash text NOT NULL CHECK (btrim(key_hash) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
);

CREATE INDEX lead_capture_rate_events_window_idx
  ON platform.lead_capture_rate_events (tenant_id, source_id, dimension, key_hash, created_at DESC);

CREATE OR REPLACE FUNCTION platform.deny_lead_capture_rate_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'lead_capture_rate_events is append-only';
END;
$$;

CREATE TRIGGER lead_capture_rate_events_append_only
  BEFORE UPDATE OR DELETE ON platform.lead_capture_rate_events
  FOR EACH ROW EXECUTE FUNCTION platform.deny_lead_capture_rate_event_mutation();

ALTER TABLE platform.lead_capture_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_capture_verifications FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_capture_rate_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_capture_rate_events FORCE ROW LEVEL SECURITY;

-- 4. PUBLIC ingress helper. True only for an already-resolved PUBLIC source whose
--    id matches the request-scoped GUC. Mirrors current_lead_capture_ingress_
--    matches (0126) but for the PUBLIC rail, and requires a publishable key to
--    exist on the source.
CREATE OR REPLACE FUNCTION platform.current_lead_capture_public_ingress_matches(
  p_tenant_id uuid,
  p_organization_id uuid,
  p_source_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = platform, pg_temp
AS $$
  SELECT
    p_tenant_id = platform.current_tenant_id()
    AND nullif(current_setting('app.lead_capture_public_source_id', true), '')::uuid = p_source_id
    AND EXISTS (
      SELECT 1
        FROM platform.lead_capture_sources AS s
       WHERE s.source_id = p_source_id
         AND s.tenant_id = p_tenant_id
         AND s.organization_id = p_organization_id
         AND s.status = 'ACTIVE'
         AND s.trust_rail = 'PUBLIC'
         AND s.publishable_key IS NOT NULL
    );
$$;

REVOKE ALL ON FUNCTION platform.current_lead_capture_public_ingress_matches(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.current_lead_capture_public_ingress_matches(uuid, uuid, uuid) TO PUBLIC;

-- The source coordinate reads only its own public config (origins, publishable
-- key, layer) before the app checks key + origin. It exposes no business data
-- and no signed-rail verification key beyond what is already public.
CREATE POLICY lead_capture_sources_public_ingress_select
  ON platform.lead_capture_sources
  FOR SELECT
  USING (
    tenant_id = platform.current_tenant_id()
    AND source_id = nullif(current_setting('app.lead_capture_public_source_id', true), '')::uuid
    AND trust_rail = 'PUBLIC'
  );

CREATE POLICY lead_capture_leads_public_ingress_select
  ON platform.lead_capture_leads
  FOR SELECT
  USING (platform.current_lead_capture_public_ingress_matches(tenant_id, organization_id, source_id));

CREATE POLICY lead_capture_leads_public_ingress_insert
  ON platform.lead_capture_leads
  FOR INSERT
  WITH CHECK (
    stage = 'NEW_ENQUIRY'
    AND status = 'ACTIVE'
    AND verification_state = 'UNVERIFIED'
    AND platform.current_lead_capture_public_ingress_matches(tenant_id, organization_id, source_id)
  );

-- Verification only ever moves a lead UNVERIFIED -> VERIFIED; it can never change
-- scope, stage or status via this path.
CREATE POLICY lead_capture_leads_public_verify_update
  ON platform.lead_capture_leads
  FOR UPDATE
  USING (
    verification_state = 'UNVERIFIED'
    AND platform.current_lead_capture_public_ingress_matches(tenant_id, organization_id, source_id)
  )
  WITH CHECK (
    stage = 'NEW_ENQUIRY'
    AND status = 'ACTIVE'
    AND verification_state IN ('UNVERIFIED','VERIFIED')
    AND platform.current_lead_capture_public_ingress_matches(tenant_id, organization_id, source_id)
  );

CREATE POLICY lead_capture_submissions_public_ingress_select
  ON platform.lead_capture_submissions
  FOR SELECT
  USING (platform.current_lead_capture_public_ingress_matches(tenant_id, organization_id, source_id));

CREATE POLICY lead_capture_submissions_public_ingress_insert
  ON platform.lead_capture_submissions
  FOR INSERT
  WITH CHECK (platform.current_lead_capture_public_ingress_matches(tenant_id, organization_id, source_id));

CREATE POLICY lead_capture_verifications_public_ingress_select
  ON platform.lead_capture_verifications
  FOR SELECT
  USING (platform.current_lead_capture_public_ingress_matches(tenant_id, organization_id, source_id));

CREATE POLICY lead_capture_verifications_public_ingress_insert
  ON platform.lead_capture_verifications
  FOR INSERT
  WITH CHECK (platform.current_lead_capture_public_ingress_matches(tenant_id, organization_id, source_id));

CREATE POLICY lead_capture_verifications_public_ingress_update
  ON platform.lead_capture_verifications
  FOR UPDATE
  USING (platform.current_lead_capture_public_ingress_matches(tenant_id, organization_id, source_id))
  WITH CHECK (platform.current_lead_capture_public_ingress_matches(tenant_id, organization_id, source_id));

CREATE POLICY lead_capture_rate_events_public_ingress_select
  ON platform.lead_capture_rate_events
  FOR SELECT
  USING (platform.current_lead_capture_public_ingress_matches(tenant_id, organization_id, source_id));

CREATE POLICY lead_capture_rate_events_public_ingress_insert
  ON platform.lead_capture_rate_events
  FOR INSERT
  WITH CHECK (platform.current_lead_capture_public_ingress_matches(tenant_id, organization_id, source_id));

-- Governed (authenticated) organization-scoped reads for support/audit of the
-- verification records, consistent with the other capture tables.
CREATE POLICY lead_capture_verifications_organization_isolation
  ON platform.lead_capture_verifications
  FOR SELECT
  USING (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  );

COMMENT ON COLUMN platform.lead_capture_leads.verification_state IS
  'NOT_REQUIRED for pre-trusted (signed/internal) leads; UNVERIFIED public leads are parked out of the pipeline until an OTP challenge promotes them to VERIFIED.';
COMMENT ON TABLE platform.lead_capture_verifications IS
  'OTP challenges for PUBLIC-rail capture. Codes stored only as a salted hash; plaintext is delivered out of band and never persisted.';
COMMENT ON TABLE platform.lead_capture_rate_events IS
  'Append-only hashed rate signal (by IP and contact) throttling a PUBLIC capture source. No raw IP or email is stored.';

COMMIT;
