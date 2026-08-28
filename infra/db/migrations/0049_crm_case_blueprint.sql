BEGIN;

-- Decision Fabric — seed the platform workflow blueprint that governs CRM cases.
--
-- Cases reserve blueprint_key/workflow_instance_id as a binding seam (0046).
-- This provides the blueprint they bind to: a PLATFORM-scoped, ACTIVE lifecycle
-- for work_type_key 'crm.case'. Platform blueprints (tenant_id NULL) are visible
-- to every tenant via the workflow_blueprints_select policy, so any workspace can
-- start a governed case workflow against it without authoring its own.
--
-- The stages payload matches the WorkflowStageDefinition shape (camelCase keys)
-- consumed by @expadio/workflow's instantiate/transition domain, so the runtime
-- reads it back without translation. Migrations run as a superuser, which
-- bypasses the FORCE row-level security on this table; the app runtime only ever
-- reads this row.

INSERT INTO platform.workflow_blueprints (
  tenant_id, blueprint_key, version, label, work_type_key, source, state,
  allows_stage_addition, allows_stage_reorder, allows_stage_deactivation,
  minimum_required_stage_keys, stages, published_by_subject_id, published_at
)
SELECT
  NULL, 'crm.case', 1, 'CRM case lifecycle', 'crm.case', 'PLATFORM', 'ACTIVE',
  false, false, false,
  '{}'::text[],
  $json$[
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
      "requiredParticipantKeys": [], "decisionRequired": true, "decisionOutcomes": ["APPROVE", "RETURN"],
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
  'system', now()
WHERE NOT EXISTS (
  SELECT 1 FROM platform.workflow_blueprints
   WHERE tenant_id IS NULL AND blueprint_key = 'crm.case' AND version = 1
);

COMMIT;
