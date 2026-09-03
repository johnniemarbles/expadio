BEGIN;

-- Gate 3 (operating depth) — activity timeline, notes, and tasks.
--
-- A unified, append-only activity log per lead/contact (system events, notes,
-- stage/assignment/communication entries) plus a mutable task list with due
-- dates. Organization-scoped; capture may append SYSTEM activities at ingest,
-- operators author notes/tasks through the authenticated management surface.

CREATE TABLE platform.lead_activities (
  activity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  capture_lead_id uuid,
  contact_id uuid,
  crm_lead_id uuid,
  activity_type text NOT NULL CHECK (activity_type IN (
    'SYSTEM','NOTE','STAGE_CHANGE','STATUS_CHANGE','ASSIGNMENT','COMMUNICATION','DISCOVERY','TASK'
  )),
  actor_subject_id text,
  body text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),
  FOREIGN KEY (capture_lead_id, tenant_id, organization_id)
    REFERENCES platform.lead_capture_leads(capture_lead_id, tenant_id, organization_id),
  FOREIGN KEY (contact_id, tenant_id, organization_id)
    REFERENCES platform.lead_contacts(contact_id, tenant_id, organization_id),
  -- A note must carry text; system entries may be structured metadata only.
  CONSTRAINT lead_activity_note_body CHECK (activity_type <> 'NOTE' OR btrim(coalesce(body, '')) <> ''),
  -- An activity anchors to at least one subject.
  CONSTRAINT lead_activity_anchor CHECK (capture_lead_id IS NOT NULL OR contact_id IS NOT NULL OR crm_lead_id IS NOT NULL)
);
CREATE INDEX lead_activities_capture_idx
  ON platform.lead_activities (tenant_id, organization_id, capture_lead_id, occurred_at DESC)
  WHERE capture_lead_id IS NOT NULL;
CREATE INDEX lead_activities_contact_idx
  ON platform.lead_activities (tenant_id, organization_id, contact_id, occurred_at DESC)
  WHERE contact_id IS NOT NULL;

CREATE OR REPLACE FUNCTION platform.deny_lead_activity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lead_activities is append-only';
END;
$$;
CREATE TRIGGER lead_activities_append_only
  BEFORE UPDATE OR DELETE ON platform.lead_activities
  FOR EACH ROW EXECUTE FUNCTION platform.deny_lead_activity_mutation();

CREATE TABLE platform.lead_tasks (
  task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  capture_lead_id uuid,
  crm_lead_id uuid,
  title text NOT NULL CHECK (btrim(title) <> '' AND char_length(title) <= 200),
  description text,
  assignee_subject_id text,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DONE','CANCELLED')),
  completed_at timestamptz,
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),
  FOREIGN KEY (capture_lead_id, tenant_id, organization_id)
    REFERENCES platform.lead_capture_leads(capture_lead_id, tenant_id, organization_id),
  CONSTRAINT lead_task_anchor CHECK (capture_lead_id IS NOT NULL OR crm_lead_id IS NOT NULL),
  CONSTRAINT lead_task_completed_shape CHECK (status <> 'DONE' OR completed_at IS NOT NULL)
);
CREATE INDEX lead_tasks_queue_idx
  ON platform.lead_tasks (tenant_id, organization_id, status, due_at NULLS LAST);
CREATE INDEX lead_tasks_capture_idx
  ON platform.lead_tasks (tenant_id, organization_id, capture_lead_id)
  WHERE capture_lead_id IS NOT NULL;

ALTER TABLE platform.lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_activities FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_tasks FORCE ROW LEVEL SECURITY;

CREATE POLICY lead_activities_organization_isolation ON platform.lead_activities
  FOR ALL
  USING (tenant_id = platform.current_tenant_id() AND platform.current_context_can_access_organization(tenant_id, organization_id))
  WITH CHECK (tenant_id = platform.current_tenant_id() AND platform.current_context_can_access_organization(tenant_id, organization_id));
CREATE POLICY lead_tasks_organization_isolation ON platform.lead_tasks
  FOR ALL
  USING (tenant_id = platform.current_tenant_id() AND platform.current_context_can_access_organization(tenant_id, organization_id))
  WITH CHECK (tenant_id = platform.current_tenant_id() AND platform.current_context_can_access_organization(tenant_id, organization_id));

-- Capture ingress may append SYSTEM activities (e.g. "captured") bound to the source.
CREATE POLICY lead_activities_public_ingress ON platform.lead_activities
  FOR ALL
  USING (platform.current_public_capture_source_scope(tenant_id, organization_id))
  WITH CHECK (activity_type = 'SYSTEM' AND platform.current_public_capture_source_scope(tenant_id, organization_id));
CREATE POLICY lead_activities_signed_ingress ON platform.lead_activities
  FOR ALL
  USING (platform.current_signed_capture_source_scope(tenant_id, organization_id))
  WITH CHECK (activity_type = 'SYSTEM' AND platform.current_signed_capture_source_scope(tenant_id, organization_id));

COMMENT ON TABLE platform.lead_activities IS
  'Append-only unified activity timeline for leads/contacts. Notes carry text; system/structured entries carry metadata.';
COMMENT ON TABLE platform.lead_tasks IS
  'Operator task list per lead: assignee, due date, and OPEN/DONE/CANCELLED status.';

COMMIT;
