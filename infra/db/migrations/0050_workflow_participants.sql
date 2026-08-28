BEGIN;

-- Decision Fabric — participant assignments + a stage that requires one.
--
-- A workflow stage can name semantic participant slots (e.g. "reviewer").
-- Entering that stage is gated until the slots are filled. This table records
-- who fills a slot for a given instance/stage; tenant-scoped and RLS-forced.
-- Migrations run as a superuser, which bypasses FORCE RLS to seed/update the
-- platform blueprint below; the app runtime only ever operates within a tenant.

CREATE TABLE platform.workflow_participant_assignments (
  assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  instance_id uuid NOT NULL,
  stage_key text NOT NULL CHECK (btrim(stage_key) <> ''),
  participant_key text NOT NULL CHECK (btrim(participant_key) <> ''),
  target_kind text NOT NULL CHECK (target_kind IN (
    'USER','ROLE','PERSONA','TEAM','QUEUE','ORGANIZATION','TERRITORY','EXTERNAL_PARTY','SYSTEM','AI_AGENT'
  )),
  target_key text NOT NULL CHECK (btrim(target_key) <> ''),
  status text NOT NULL DEFAULT 'ASSIGNED'
    CHECK (status IN ('ASSIGNED','UNASSIGNED','INELIGIBLE','UNAVAILABLE')),
  assigned_by_subject_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (instance_id, tenant_id)
    REFERENCES platform.workflow_instances(instance_id, tenant_id)
    ON DELETE CASCADE,
  UNIQUE (tenant_id, instance_id, stage_key, participant_key)
);

CREATE INDEX workflow_participant_assignments_lookup_idx
  ON platform.workflow_participant_assignments (tenant_id, instance_id, stage_key);

ALTER TABLE platform.workflow_participant_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.workflow_participant_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_participant_assignments_tenant_all
  ON platform.workflow_participant_assignments
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

-- Make the REVIEW stage of the platform crm.case blueprint require a reviewer,
-- so entering REVIEW is gated until a reviewer participant is assigned.
UPDATE platform.workflow_blueprints
   SET stages = $json$[
    {
      "stageKey": "INTAKE", "label": "Intake", "sequence": 0, "kind": "QUALIFICATION",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": [], "decisionRequired": false, "decisionOutcomes": [],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "RETURN"
    },
    {
      "stageKey": "IN_PROGRESS", "label": "In progress", "sequence": 1, "kind": "EXECUTION",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": [], "decisionRequired": false, "decisionOutcomes": [],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "RETURN"
    },
    {
      "stageKey": "REVIEW", "label": "Review", "sequence": 2, "kind": "REVIEW",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": ["reviewer"], "decisionRequired": true, "decisionOutcomes": ["APPROVE", "RETURN"],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "RETURN"
    },
    {
      "stageKey": "RESOLVED", "label": "Resolved", "sequence": 3, "kind": "DECISION",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": [], "decisionRequired": false, "decisionOutcomes": [],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "TERMINATE"
    }
  ]$json$::jsonb,
       updated_at = now()
 WHERE tenant_id IS NULL AND blueprint_key = 'crm.case' AND version = 1;

COMMIT;
