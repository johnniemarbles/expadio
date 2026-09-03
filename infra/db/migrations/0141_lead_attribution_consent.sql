BEGIN;

-- Gate 2 — Attribution & consent capture.
--
-- The submission contract already carries attribution + consent; this makes them
-- durable and queryable rather than only living inside raw_payload. Attribution
-- is an append-only touch log (first-touch is the earliest, latest-touch the most
-- recent); consent is an append-only record with the version text captured at the
-- moment of grant. Both are organization-scoped and written at capture under the
-- request source context.

CREATE TABLE platform.lead_attribution_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  contact_id uuid,
  capture_lead_id uuid,
  source_key text,
  page_url text,
  referrer_url text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  utm_id text,
  gclid text,
  fbclid text,
  referral_code text,
  affiliate_key text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),
  FOREIGN KEY (contact_id, tenant_id, organization_id)
    REFERENCES platform.lead_contacts(contact_id, tenant_id, organization_id),
  FOREIGN KEY (capture_lead_id, tenant_id, organization_id)
    REFERENCES platform.lead_capture_leads(capture_lead_id, tenant_id, organization_id)
);
CREATE INDEX lead_attribution_events_contact_idx
  ON platform.lead_attribution_events (tenant_id, organization_id, contact_id, occurred_at);
CREATE INDEX lead_attribution_events_lead_idx
  ON platform.lead_attribution_events (tenant_id, organization_id, capture_lead_id, occurred_at);

CREATE TABLE platform.lead_consent_records (
  consent_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  contact_id uuid,
  capture_lead_id uuid,
  channel text NOT NULL CHECK (channel IN ('EMAIL','SMS','WHATSAPP','VOICE')),
  purpose text NOT NULL CHECK (btrim(purpose) <> ''),
  granted boolean NOT NULL,
  text_version text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),
  FOREIGN KEY (contact_id, tenant_id, organization_id)
    REFERENCES platform.lead_contacts(contact_id, tenant_id, organization_id),
  FOREIGN KEY (capture_lead_id, tenant_id, organization_id)
    REFERENCES platform.lead_capture_leads(capture_lead_id, tenant_id, organization_id)
);
CREATE INDEX lead_consent_records_contact_idx
  ON platform.lead_consent_records (tenant_id, organization_id, contact_id, channel, occurred_at DESC);

-- First-/latest-touch summary on the person, maintained at capture.
ALTER TABLE platform.lead_contacts
  ADD COLUMN first_touch_at timestamptz,
  ADD COLUMN first_source_key text,
  ADD COLUMN last_touch_at timestamptz,
  ADD COLUMN last_source_key text;

-- Append-only: attribution and consent are evidence, never edited or deleted.
CREATE OR REPLACE FUNCTION platform.deny_lead_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lead attribution/consent records are append-only';
END;
$$;
CREATE TRIGGER lead_attribution_events_append_only
  BEFORE UPDATE OR DELETE ON platform.lead_attribution_events
  FOR EACH ROW EXECUTE FUNCTION platform.deny_lead_evidence_mutation();
CREATE TRIGGER lead_consent_records_append_only
  BEFORE UPDATE OR DELETE ON platform.lead_consent_records
  FOR EACH ROW EXECUTE FUNCTION platform.deny_lead_evidence_mutation();

ALTER TABLE platform.lead_attribution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_attribution_events FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_consent_records FORCE ROW LEVEL SECURITY;

-- Management (authenticated) read within the authorized subtree.
CREATE POLICY lead_attribution_events_organization_isolation ON platform.lead_attribution_events
  FOR ALL
  USING (tenant_id = platform.current_tenant_id() AND platform.current_context_can_access_organization(tenant_id, organization_id))
  WITH CHECK (tenant_id = platform.current_tenant_id() AND platform.current_context_can_access_organization(tenant_id, organization_id));
CREATE POLICY lead_consent_records_organization_isolation ON platform.lead_consent_records
  FOR ALL
  USING (tenant_id = platform.current_tenant_id() AND platform.current_context_can_access_organization(tenant_id, organization_id))
  WITH CHECK (tenant_id = platform.current_tenant_id() AND platform.current_context_can_access_organization(tenant_id, organization_id));

-- Capture ingress may append attribution + consent bound to the request source.
CREATE POLICY lead_attribution_events_public_ingress ON platform.lead_attribution_events
  FOR ALL
  USING (platform.current_public_capture_source_scope(tenant_id, organization_id))
  WITH CHECK (platform.current_public_capture_source_scope(tenant_id, organization_id));
CREATE POLICY lead_attribution_events_signed_ingress ON platform.lead_attribution_events
  FOR ALL
  USING (platform.current_signed_capture_source_scope(tenant_id, organization_id))
  WITH CHECK (platform.current_signed_capture_source_scope(tenant_id, organization_id));
CREATE POLICY lead_consent_records_public_ingress ON platform.lead_consent_records
  FOR ALL
  USING (platform.current_public_capture_source_scope(tenant_id, organization_id))
  WITH CHECK (platform.current_public_capture_source_scope(tenant_id, organization_id));
CREATE POLICY lead_consent_records_signed_ingress ON platform.lead_consent_records
  FOR ALL
  USING (platform.current_signed_capture_source_scope(tenant_id, organization_id))
  WITH CHECK (platform.current_signed_capture_source_scope(tenant_id, organization_id));

COMMENT ON TABLE platform.lead_attribution_events IS
  'Append-only attribution touch log. Earliest row is first-touch; most recent is latest-touch. Provenance only — never authorization.';
COMMENT ON TABLE platform.lead_consent_records IS
  'Append-only consent evidence: channel, purpose, grant, and the version text captured at the moment of grant.';

COMMIT;
