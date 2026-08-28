-- Vendor onboarding v2: a decision-required APPROVAL stage.
--
-- The first vendor blueprint (0053, v1) proved a non-CRM subject runs the
-- generic runtime through participant gates. This version adds the piece that
-- was deliberately left out: a governed *decision*. APPROVAL sits between
-- SCREENING and ACTIVE and is decisionRequired, so a vendor cannot go live until
-- an authorized approver records an APPROVE — enforced by the same authority
-- gate as a CRM case, but with no monetary requirement (vendor.onboarding has no
-- registered authority deriver, so a decision is gated by role + separation of
-- duties alone). This exercises the work-type-agnostic decision path end to end
-- on a second vertical.
--
-- v2 is published ACTIVE and v1 is SUPERSEDED, so the resolver hands new vendors
-- v2 while existing v1 instances keep resolving v1 by identity. The blueprint's
-- shape is otherwise identical to v1's — same participant gate on SCREENING.

UPDATE platform.workflow_blueprints
   SET state = 'SUPERSEDED'
 WHERE tenant_id IS NULL AND blueprint_key = 'vendor.onboarding' AND version = 1 AND state = 'ACTIVE';

INSERT INTO platform.workflow_blueprints (
  tenant_id, blueprint_key, version, label, work_type_key, source, state,
  parent_blueprint_key, parent_blueprint_version,
  allows_stage_addition, allows_stage_reorder, allows_stage_deactivation,
  minimum_required_stage_keys, stages, published_by_subject_id, published_at
)
SELECT
  NULL, 'vendor.onboarding', 2, 'Vendor onboarding', 'vendor.onboarding', 'PLATFORM', 'ACTIVE',
  'vendor.onboarding', 1,
  false, false, false,
  '{}'::text[],
  $json$[
    {
      "stageKey": "SUBMITTED", "label": "Submitted", "sequence": 0, "kind": "APPLICATION",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": [], "decisionRequired": false, "decisionOutcomes": [],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "RETURN"
    },
    {
      "stageKey": "SCREENING", "label": "Screening", "sequence": 1, "kind": "COMPLIANCE",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": ["screener"], "decisionRequired": false, "decisionOutcomes": [],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "RETURN"
    },
    {
      "stageKey": "APPROVAL", "label": "Approval", "sequence": 2, "kind": "REVIEW",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": [], "decisionRequired": true, "decisionOutcomes": ["APPROVE", "REJECT"],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "RETURN"
    },
    {
      "stageKey": "ACTIVE", "label": "Active", "sequence": 3, "kind": "EXECUTION",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": [], "decisionRequired": false, "decisionOutcomes": [],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "TERMINATE"
    }
  ]$json$::jsonb,
  NULL, now();
