BEGIN;

ALTER TABLE platform.lead_capture_leads
  ADD COLUMN stage_entered_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN close_reason_code text,
  ADD COLUMN closed_at timestamptz;

CREATE TABLE platform.lead_capture_stage_history (
  stage_history_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  capture_lead_id uuid NOT NULL,
  source_id uuid NOT NULL,
  from_stage text NOT NULL,
  to_stage text NOT NULL,
  transition_kind text NOT NULL CHECK (transition_kind IN ('STANDARD','OVERRIDE')),
  actor_subject_id text NOT NULL CHECK (btrim(actor_subject_id) <> ''),
  reason text,
  close_reason_code text,
  duration_in_previous_seconds bigint NOT NULL CHECK (duration_in_previous_seconds >= 0),
  changed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (capture_lead_id, tenant_id, organization_id)
    REFERENCES platform.lead_capture_leads(capture_lead_id, tenant_id, organization_id),
  FOREIGN KEY (source_id, tenant_id, organization_id)
    REFERENCES platform.lead_capture_sources(source_id, tenant_id, organization_id)
);

CREATE INDEX lead_capture_stage_history_scope_lead_idx
  ON platform.lead_capture_stage_history (tenant_id, organization_id, capture_lead_id, changed_at DESC);

CREATE OR REPLACE FUNCTION platform.lead_capture_standard_next_stage(p_stage text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_stage
    WHEN 'NEW_ENQUIRY' THEN 'CONTACT_ATTEMPTED'
    WHEN 'CONTACT_ATTEMPTED' THEN 'CONTACTED'
    WHEN 'CONTACTED' THEN 'QUALIFICATION'
    WHEN 'QUALIFICATION' THEN 'QUALIFIED'
    WHEN 'QUALIFIED' THEN 'DISCOVERY_SCHEDULED'
    WHEN 'DISCOVERY_SCHEDULED' THEN 'DISCOVERY_COMPLETED'
    WHEN 'DISCOVERY_COMPLETED' THEN 'OPPORTUNITY_EVALUATION'
    WHEN 'OPPORTUNITY_EVALUATION' THEN 'APPLICATION_INVITED'
    WHEN 'APPLICATION_INVITED' THEN 'APPLICATION_STARTED'
    WHEN 'APPLICATION_STARTED' THEN 'APPLICATION_SUBMITTED'
    WHEN 'APPLICATION_SUBMITTED' THEN 'DUE_DILIGENCE'
    WHEN 'DUE_DILIGENCE' THEN 'APPROVAL'
    WHEN 'APPROVAL' THEN 'AGREEMENT'
    WHEN 'AGREEMENT' THEN 'ACTIVATION'
    WHEN 'ACTIVATION' THEN 'WON'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION platform.guard_lead_capture_stage_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actor text := nullif(btrim(current_setting('app.lead_capture_transition_actor', true)), '');
  reason text := nullif(btrim(current_setting('app.lead_capture_transition_reason', true)), '');
  close_reason text := nullif(btrim(current_setting('app.lead_capture_close_reason', true)), '');
  standard_next text;
BEGIN
  IF NEW.stage IS NOT DISTINCT FROM OLD.stage THEN
    RETURN NEW;
  END IF;

  IF actor IS NULL THEN
    RAISE EXCEPTION 'lead capture stage transition requires governed actor context' USING ERRCODE = '42501';
  END IF;

  standard_next := platform.lead_capture_standard_next_stage(OLD.stage);
  IF NEW.stage IS DISTINCT FROM standard_next AND reason IS NULL THEN
    RAISE EXCEPTION 'non-standard lead capture stage transition requires reason' USING ERRCODE = '23514';
  END IF;

  IF NEW.stage IN ('WON','LOST','DISQUALIFIED') AND close_reason IS NULL THEN
    RAISE EXCEPTION 'terminal lead capture stage requires close reason' USING ERRCODE = '23514';
  END IF;

  NEW.stage_entered_at := now();
  IF NEW.stage IN ('WON','LOST','DISQUALIFIED') THEN
    NEW.close_reason_code := close_reason;
    NEW.closed_at := now();
    NEW.status := CASE NEW.stage
      WHEN 'WON' THEN 'CONVERTED'
      WHEN 'LOST' THEN 'LOST'
      ELSE 'DISQUALIFIED'
    END;
  ELSE
    NEW.close_reason_code := NULL;
    NEW.closed_at := NULL;
    IF OLD.stage IN ('WON','LOST','DISQUALIFIED') AND NEW.status IN ('CONVERTED','LOST','DISQUALIFIED','ARCHIVED') THEN
      NEW.status := 'ACTIVE';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION platform.record_lead_capture_stage_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actor text := nullif(btrim(current_setting('app.lead_capture_transition_actor', true)), '');
  reason text := nullif(btrim(current_setting('app.lead_capture_transition_reason', true)), '');
  close_reason text := nullif(btrim(current_setting('app.lead_capture_close_reason', true)), '');
  kind text;
BEGIN
  IF NEW.stage IS NOT DISTINCT FROM OLD.stage THEN
    RETURN NULL;
  END IF;

  kind := CASE
    WHEN NEW.stage = platform.lead_capture_standard_next_stage(OLD.stage) THEN 'STANDARD'
    ELSE 'OVERRIDE'
  END;

  INSERT INTO platform.lead_capture_stage_history (
    tenant_id, organization_id, capture_lead_id, source_id,
    from_stage, to_stage, transition_kind, actor_subject_id,
    reason, close_reason_code, duration_in_previous_seconds, changed_at
  ) VALUES (
    NEW.tenant_id, NEW.organization_id, NEW.capture_lead_id, NEW.source_id,
    OLD.stage, NEW.stage, kind, actor,
    reason, close_reason,
    greatest(0, floor(extract(epoch FROM (NEW.stage_entered_at - OLD.stage_entered_at)))::bigint),
    NEW.stage_entered_at
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER lead_capture_stage_guard
  BEFORE UPDATE OF stage ON platform.lead_capture_leads
  FOR EACH ROW EXECUTE FUNCTION platform.guard_lead_capture_stage_transition();

CREATE TRIGGER lead_capture_stage_history_record
  AFTER UPDATE OF stage ON platform.lead_capture_leads
  FOR EACH ROW EXECUTE FUNCTION platform.record_lead_capture_stage_transition();

CREATE OR REPLACE FUNCTION platform.reject_lead_capture_stage_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'lead_capture_stage_history is append-only';
END;
$$;

CREATE TRIGGER lead_capture_stage_history_append_only
  BEFORE UPDATE OR DELETE ON platform.lead_capture_stage_history
  FOR EACH ROW EXECUTE FUNCTION platform.reject_lead_capture_stage_history_mutation();

ALTER TABLE platform.lead_capture_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_capture_stage_history FORCE ROW LEVEL SECURITY;

CREATE POLICY lead_capture_stage_history_organization_select
  ON platform.lead_capture_stage_history
  FOR SELECT
  USING (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  );

CREATE POLICY lead_capture_stage_history_organization_insert
  ON platform.lead_capture_stage_history
  FOR INSERT
  WITH CHECK (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  );

COMMENT ON TABLE platform.lead_capture_stage_history IS
  'Append-only Demand Capture journey history. Every stage mutation is recorded atomically by database trigger.';
COMMENT ON FUNCTION platform.lead_capture_standard_next_stage(text) IS
  'Fail-closed canonical next step. Non-standard/backward/nurture/terminal alternatives require an explicit governed reason.';

COMMIT;
