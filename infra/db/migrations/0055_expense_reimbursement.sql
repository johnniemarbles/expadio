-- Third vertical: expense reimbursement.
--
-- A third, deliberately different business process on the same engine — chosen
-- to prove the authority seam (0261/lib/workflow-authority-derivation.ts) at its
-- hardest point. Three verticals now derive approval authority three different
-- ways: a CRM case from its account's *agreements*, a vendor from *nothing*
-- (role + SoD only), and an expense from its *own amount*. The engine names none
-- of them; each is a registered deriver.
--
-- MANAGER_REVIEW is a single stage that exercises both gates at once: a required
-- "manager" participant blocks entering it, and a decision (APPROVE) blocks
-- leaving it — and that decision must clear a monetary threshold equal to the
-- expense's amount.

CREATE TABLE platform.expense_reports (
  expense_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  employee_subject_id text,
  purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 200),
  amount_minor_units bigint NOT NULL CHECK (amount_minor_units > 0),
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','APPROVED','PAID','REJECTED')),
  -- The Decision Fabric binding seam — identical to crm_cases and vendors.
  blueprint_key text,
  workflow_instance_id uuid,
  stage_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX expense_reports_tenant_idx ON platform.expense_reports(tenant_id, status, created_at DESC);

ALTER TABLE platform.expense_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.expense_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY expense_reports_tenant_isolation ON platform.expense_reports
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

-- The PLATFORM blueprint that governs reimbursement. Same camelCase stage shape
-- as crm.case (0049) and vendor.onboarding (0053/0054). Tenant_id NULL => every
-- tenant binds to it.
INSERT INTO platform.workflow_blueprints (
  tenant_id, blueprint_key, version, label, work_type_key, source, state,
  allows_stage_addition, allows_stage_reorder, allows_stage_deactivation,
  minimum_required_stage_keys, stages, published_by_subject_id, published_at
)
SELECT
  NULL, 'expense.reimbursement', 1, 'Expense reimbursement', 'expense.reimbursement', 'PLATFORM', 'ACTIVE',
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
      "stageKey": "MANAGER_REVIEW", "label": "Manager review", "sequence": 1, "kind": "REVIEW",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": ["manager"], "decisionRequired": true, "decisionOutcomes": ["APPROVE", "REJECT"],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "RETURN"
    },
    {
      "stageKey": "PAID", "label": "Paid", "sequence": 2, "kind": "EXECUTION",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": [], "decisionRequired": false, "decisionOutcomes": [],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "TERMINATE"
    }
  ]$json$::jsonb,
  NULL, now();
