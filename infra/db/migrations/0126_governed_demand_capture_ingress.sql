BEGIN;

ALTER TABLE platform.lead_capture_sources
  ADD COLUMN verification_algorithm text NOT NULL DEFAULT 'ED25519'
    CHECK (verification_algorithm IN ('ED25519')),
  ADD COLUMN verification_public_key text,
  ADD COLUMN verification_key_id text,
  ADD COLUMN max_clock_skew_seconds integer NOT NULL DEFAULT 300
    CHECK (max_clock_skew_seconds BETWEEN 30 AND 3600);

ALTER TABLE platform.lead_capture_sources
  ADD CONSTRAINT lead_capture_sources_signed_key_required
  CHECK (
    require_signed_ticket = false
    OR (
      verification_public_key IS NOT NULL
      AND btrim(verification_public_key) <> ''
      AND verification_key_id IS NOT NULL
      AND btrim(verification_key_id) <> ''
    )
  ) NOT VALID;

-- Existing rows predate signed public ingress and remain non-ingestable until
-- explicitly configured with a public verification key. New governed sources
-- created by the Brand API are signed-only.

CREATE OR REPLACE FUNCTION platform.current_lead_capture_ingress_matches(
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
    AND nullif(current_setting('app.lead_capture_ingress_source_id', true), '')::uuid = p_source_id
    AND EXISTS (
      SELECT 1
        FROM platform.lead_capture_sources AS s
       WHERE s.source_id = p_source_id
         AND s.tenant_id = p_tenant_id
         AND s.organization_id = p_organization_id
         AND s.status = 'ACTIVE'
         AND s.require_signed_ticket = true
         AND s.verification_algorithm = 'ED25519'
         AND s.verification_public_key IS NOT NULL
    );
$$;

REVOKE ALL ON FUNCTION platform.current_lead_capture_ingress_matches(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.current_lead_capture_ingress_matches(uuid, uuid, uuid) TO PUBLIC;

-- The source coordinate may be used to read only its own public verification
-- metadata before signature verification. This does not grant business-data
-- access and stores no private/shared credential.
CREATE POLICY lead_capture_sources_ingress_select
  ON platform.lead_capture_sources
  FOR SELECT
  USING (
    tenant_id = platform.current_tenant_id()
    AND source_id = nullif(current_setting('app.lead_capture_ingress_source_id', true), '')::uuid
  );

CREATE POLICY lead_capture_leads_ingress_select
  ON platform.lead_capture_leads
  FOR SELECT
  USING (
    platform.current_lead_capture_ingress_matches(tenant_id, organization_id, source_id)
  );

CREATE POLICY lead_capture_leads_ingress_insert
  ON platform.lead_capture_leads
  FOR INSERT
  WITH CHECK (
    stage = 'NEW_ENQUIRY'
    AND status = 'ACTIVE'
    AND platform.current_lead_capture_ingress_matches(tenant_id, organization_id, source_id)
  );

CREATE POLICY lead_capture_submissions_ingress_select
  ON platform.lead_capture_submissions
  FOR SELECT
  USING (
    platform.current_lead_capture_ingress_matches(tenant_id, organization_id, source_id)
  );

CREATE POLICY lead_capture_submissions_ingress_insert
  ON platform.lead_capture_submissions
  FOR INSERT
  WITH CHECK (
    platform.current_lead_capture_ingress_matches(tenant_id, organization_id, source_id)
  );

COMMENT ON COLUMN platform.lead_capture_sources.verification_public_key IS
  'Ed25519 public verification key for signed external Demand Capture ingress. No private/shared secret is stored.';
COMMENT ON FUNCTION platform.current_lead_capture_ingress_matches(uuid, uuid, uuid) IS
  'Source-bound RLS helper for already-signature-verified external Demand Capture writes.';

COMMIT;
