BEGIN;

CREATE TABLE platform.communication_consent_events (
  consent_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  organization_id uuid,
  subject_id text,
  recipient_key text NOT NULL CHECK (btrim(recipient_key) <> ''),
  channel text NOT NULL CHECK (channel IN ('email','sms','whatsapp','voice','in_app','push','rcs')),
  purpose text NOT NULL CHECK (purpose IN ('transactional','marketing','system')),
  event_type text NOT NULL CHECK (event_type IN ('GRANTED','WITHDRAWN')),
  source text NOT NULL CHECK (source IN ('FORM','API','IMPORT','ADMIN','SYSTEM','OTHER')),
  policy_version text,
  evidence_ref text,
  effective_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT communication_consent_event_validity CHECK (
    expires_at IS NULL OR expires_at > effective_at
  )
);

CREATE INDEX communication_consent_events_lookup_idx
  ON platform.communication_consent_events (
    tenant_id,
    organization_id,
    channel,
    purpose,
    lower(recipient_key),
    effective_at DESC,
    recorded_at DESC
  );

CREATE INDEX communication_consent_events_subject_idx
  ON platform.communication_consent_events (
    tenant_id,
    subject_id,
    recorded_at DESC
  )
  WHERE subject_id IS NOT NULL;

CREATE OR REPLACE FUNCTION platform.reject_communication_consent_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'communication consent events are append-only';
END;
$$;

CREATE TRIGGER communication_consent_events_append_only
BEFORE UPDATE OR DELETE ON platform.communication_consent_events
FOR EACH ROW EXECUTE FUNCTION platform.reject_communication_consent_event_mutation();

ALTER TABLE platform.communication_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_consent_events FORCE ROW LEVEL SECURITY;
CREATE POLICY communication_consent_events_tenant_isolation
  ON platform.communication_consent_events
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
