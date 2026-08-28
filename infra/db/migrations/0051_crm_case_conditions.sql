BEGIN;

-- Decision Fabric — entry condition on the crm.case terminal stage.
--
-- A case may not be RESOLVED until it is linked to a customer account
-- (case.has_account). This is a blueprint-declared entry condition, evaluated
-- by the app's CrmCaseConditionEvaluator against the case's own data; the
-- workflow engine stays neutral. Migrations run as superuser, bypassing FORCE
-- RLS to update the platform blueprint.

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
      "entryConditions": [{ "type": "case.has_account" }], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "TERMINATE"
    }
  ]$json$::jsonb,
       updated_at = now()
 WHERE tenant_id IS NULL AND blueprint_key = 'crm.case' AND version = 1;

COMMIT;
