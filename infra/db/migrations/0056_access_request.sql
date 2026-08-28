-- Fourth vertical: access requests.
--
-- Built by following the "Adding a vertical" recipe in
-- docs/architecture/decision-fabric-cases.md — a fresh domain (a subject asks
-- for a system entitlement, security reviews it, it is granted) on the same
-- engine, with no runtime change. Like vendor onboarding it is gated by role +
-- separation of duties alone (no registered authority deriver), which is the
-- appropriate basis for an access decision: the reviewer must hold a governing
-- role and must not be the requester.
--
-- SECURITY_REVIEW is one stage exercising both gates: a required
-- "security_reviewer" participant blocks entry, and a decision (APPROVE/REJECT)
-- blocks exit to GRANTED.

CREATE TABLE platform.access_requests (
  access_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  requester_subject_id text,
  resource text NOT NULL CHECK (char_length(resource) BETWEEN 1 AND 200),
  justification text,
  status text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','GRANTED','REJECTED')),
  -- The Decision Fabric binding seam — identical to crm_cases/vendors/expenses.
  blueprint_key text,
  workflow_instance_id uuid,
  stage_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX access_requests_tenant_idx ON platform.access_requests(tenant_id, status, created_at DESC);

ALTER TABLE platform.access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.access_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY access_requests_tenant_isolation ON platform.access_requests
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

-- The PLATFORM blueprint that governs access requests. Same camelCase stage
-- shape as the other verticals; tenant_id NULL => every tenant binds to it.
INSERT INTO platform.workflow_blueprints (
  tenant_id, blueprint_key, version, label, work_type_key, source, state,
  allows_stage_addition, allows_stage_reorder, allows_stage_deactivation,
  minimum_required_stage_keys, stages, published_by_subject_id, published_at
)
SELECT
  NULL, 'access.request', 1, 'Access request', 'access.request', 'PLATFORM', 'ACTIVE',
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
      "stageKey": "SECURITY_REVIEW", "label": "Security review", "sequence": 1, "kind": "REVIEW",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": ["security_reviewer"], "decisionRequired": true, "decisionOutcomes": ["APPROVE", "REJECT"],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "RETURN"
    },
    {
      "stageKey": "GRANTED", "label": "Granted", "sequence": 2, "kind": "EXECUTION",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": [], "decisionRequired": false, "decisionOutcomes": [],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "TERMINATE"
    }
  ]$json$::jsonb,
  NULL, now();
