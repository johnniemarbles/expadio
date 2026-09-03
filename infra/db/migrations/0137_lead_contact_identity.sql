BEGIN;

-- Gate 1 — Demand Capture identity & deduplication.
--
-- A normalized, ORGANIZATION-scoped person record resolved before CRM
-- conversion, distinct from the thin tenant-only crm_contacts projection. Only
-- an exact normalized-email match auto-links; weaker signals (phone, name) are
-- queued for human review; merges are reversible and never cross an organization.

CREATE TABLE platform.lead_contacts (
  contact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  email text,
  email_key text,
  phone text,
  phone_key text,
  first_name text,
  last_name text,
  name_key text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','MERGED')),
  merged_into_contact_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),
  UNIQUE (contact_id, tenant_id, organization_id),
  FOREIGN KEY (merged_into_contact_id, tenant_id, organization_id)
    REFERENCES platform.lead_contacts(contact_id, tenant_id, organization_id),
  -- A merged record points at its survivor; an active one never does.
  CONSTRAINT lead_contacts_merge_shape CHECK (
    (status = 'ACTIVE' AND merged_into_contact_id IS NULL)
    OR (status = 'MERGED' AND merged_into_contact_id IS NOT NULL)
  )
);

-- One ACTIVE contact per normalized email per organization — the invariant that
-- makes exact-email AUTO_LINK safe (resolve-or-create is a no-op on the second
-- capture of the same person).
CREATE UNIQUE INDEX lead_contacts_active_email_uq
  ON platform.lead_contacts (tenant_id, organization_id, email_key)
  WHERE email_key IS NOT NULL AND status = 'ACTIVE';
CREATE INDEX lead_contacts_active_phone_idx
  ON platform.lead_contacts (tenant_id, organization_id, phone_key)
  WHERE phone_key IS NOT NULL AND status = 'ACTIVE';
CREATE INDEX lead_contacts_active_name_idx
  ON platform.lead_contacts (tenant_id, organization_id, name_key)
  WHERE name_key IS NOT NULL AND status = 'ACTIVE';

-- Link a capture lead to its resolved person.
ALTER TABLE platform.lead_capture_leads
  ADD COLUMN contact_id uuid;
ALTER TABLE platform.lead_capture_leads
  ADD CONSTRAINT lead_capture_leads_contact_fk
  FOREIGN KEY (contact_id, tenant_id, organization_id)
  REFERENCES platform.lead_contacts(contact_id, tenant_id, organization_id);

CREATE TABLE platform.lead_contact_duplicate_candidates (
  candidate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  match_contact_id uuid NOT NULL,
  confidence numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  signals jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(signals) = 'object'),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','DISMISSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by_subject_id text,
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),
  FOREIGN KEY (contact_id, tenant_id, organization_id)
    REFERENCES platform.lead_contacts(contact_id, tenant_id, organization_id),
  FOREIGN KEY (match_contact_id, tenant_id, organization_id)
    REFERENCES platform.lead_contacts(contact_id, tenant_id, organization_id),
  CONSTRAINT lead_contact_candidate_distinct CHECK (contact_id <> match_contact_id),
  UNIQUE (tenant_id, organization_id, contact_id, match_contact_id)
);
CREATE INDEX lead_contact_candidates_queue_idx
  ON platform.lead_contact_duplicate_candidates (tenant_id, organization_id, status, confidence DESC, created_at DESC);

CREATE TABLE platform.lead_contact_merges (
  merge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  survivor_contact_id uuid NOT NULL,
  merged_contact_id uuid NOT NULL,
  reason text,
  performed_by_subject_id text NOT NULL CHECK (btrim(performed_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  reversed_by_subject_id text,
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),
  FOREIGN KEY (survivor_contact_id, tenant_id, organization_id)
    REFERENCES platform.lead_contacts(contact_id, tenant_id, organization_id),
  FOREIGN KEY (merged_contact_id, tenant_id, organization_id)
    REFERENCES platform.lead_contacts(contact_id, tenant_id, organization_id),
  CONSTRAINT lead_contact_merge_distinct CHECK (survivor_contact_id <> merged_contact_id)
);
CREATE INDEX lead_contact_merges_scope_idx
  ON platform.lead_contact_merges (tenant_id, organization_id, created_at DESC);

-- Scope helpers: is there a valid ACTIVE capture ingress for this tenant+org in
-- the current request context? Unlike the per-source ingress helpers these do not
-- take a source id (contacts are not per-source); they read the request-scoped
-- source GUC and confirm it belongs to the tenant+org being written.
CREATE OR REPLACE FUNCTION platform.current_public_capture_source_scope(
  p_tenant_id uuid,
  p_organization_id uuid
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = platform, pg_temp AS $$
  SELECT p_tenant_id = platform.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM platform.lead_capture_sources s
       WHERE s.source_id = nullif(current_setting('app.lead_capture_public_source_id', true), '')::uuid
         AND s.tenant_id = p_tenant_id
         AND s.organization_id = p_organization_id
         AND s.status = 'ACTIVE'
         AND s.trust_rail = 'PUBLIC'
         AND s.publishable_key IS NOT NULL
    );
$$;
CREATE OR REPLACE FUNCTION platform.current_signed_capture_source_scope(
  p_tenant_id uuid,
  p_organization_id uuid
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = platform, pg_temp AS $$
  SELECT p_tenant_id = platform.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM platform.lead_capture_sources s
       WHERE s.source_id = nullif(current_setting('app.lead_capture_ingress_source_id', true), '')::uuid
         AND s.tenant_id = p_tenant_id
         AND s.organization_id = p_organization_id
         AND s.status = 'ACTIVE'
         AND s.require_signed_ticket = true
    );
$$;
REVOKE ALL ON FUNCTION platform.current_public_capture_source_scope(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.current_public_capture_source_scope(uuid, uuid) TO PUBLIC;
REVOKE ALL ON FUNCTION platform.current_signed_capture_source_scope(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.current_signed_capture_source_scope(uuid, uuid) TO PUBLIC;

ALTER TABLE platform.lead_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_contact_duplicate_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_contact_duplicate_candidates FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_contact_merges ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_contact_merges FORCE ROW LEVEL SECURITY;

-- Management (authenticated) — governed by subject grant + selected workspace.
CREATE POLICY lead_contacts_organization_isolation ON platform.lead_contacts
  FOR ALL
  USING (tenant_id = platform.current_tenant_id() AND platform.current_context_can_access_organization(tenant_id, organization_id))
  WITH CHECK (tenant_id = platform.current_tenant_id() AND platform.current_context_can_access_organization(tenant_id, organization_id));
CREATE POLICY lead_contact_candidates_organization_isolation ON platform.lead_contact_duplicate_candidates
  FOR ALL
  USING (tenant_id = platform.current_tenant_id() AND platform.current_context_can_access_organization(tenant_id, organization_id))
  WITH CHECK (tenant_id = platform.current_tenant_id() AND platform.current_context_can_access_organization(tenant_id, organization_id));
CREATE POLICY lead_contact_merges_organization_isolation ON platform.lead_contact_merges
  FOR ALL
  USING (tenant_id = platform.current_tenant_id() AND platform.current_context_can_access_organization(tenant_id, organization_id))
  WITH CHECK (tenant_id = platform.current_tenant_id() AND platform.current_context_can_access_organization(tenant_id, organization_id));

-- Capture ingress may resolve (SELECT) and create (INSERT) contacts + enqueue
-- review candidates, bound to the same request-scoped source as the lead write.
-- It never creates a pre-merged contact and never performs merges.
CREATE POLICY lead_contacts_public_ingress ON platform.lead_contacts
  FOR ALL
  USING (platform.current_public_capture_source_scope(tenant_id, organization_id))
  WITH CHECK (status = 'ACTIVE' AND merged_into_contact_id IS NULL AND platform.current_public_capture_source_scope(tenant_id, organization_id));
CREATE POLICY lead_contacts_signed_ingress ON platform.lead_contacts
  FOR ALL
  USING (platform.current_signed_capture_source_scope(tenant_id, organization_id))
  WITH CHECK (status = 'ACTIVE' AND merged_into_contact_id IS NULL AND platform.current_signed_capture_source_scope(tenant_id, organization_id));
CREATE POLICY lead_contact_candidates_public_ingress ON platform.lead_contact_duplicate_candidates
  FOR ALL
  USING (platform.current_public_capture_source_scope(tenant_id, organization_id))
  WITH CHECK (status = 'PENDING' AND platform.current_public_capture_source_scope(tenant_id, organization_id));
CREATE POLICY lead_contact_candidates_signed_ingress ON platform.lead_contact_duplicate_candidates
  FOR ALL
  USING (platform.current_signed_capture_source_scope(tenant_id, organization_id))
  WITH CHECK (status = 'PENDING' AND platform.current_signed_capture_source_scope(tenant_id, organization_id));

COMMENT ON TABLE platform.lead_contacts IS
  'Organization-scoped Demand Capture person identity. Exact normalized-email is the only auto-link key; merges are reversible and never cross an organization.';
COMMENT ON TABLE platform.lead_contact_duplicate_candidates IS
  'Human review queue for non-exact identity matches (phone/name). Never auto-merged.';
COMMENT ON TABLE platform.lead_contact_merges IS
  'Reversible merge ledger: survivor + merged contact, actor, reason, and reversal evidence.';

COMMIT;
