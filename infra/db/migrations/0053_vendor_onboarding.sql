BEGIN;

-- P1 Universal Business Engine — a second vertical: vendor onboarding.
--
-- The Decision Fabric is not CRM-specific: workflow_instances carry an arbitrary
-- subject type and a work_type_key, and the transition runtime, participant
-- gate, and append-only trace are all generic. This adds a non-CRM governed
-- entity — a vendor — and a PLATFORM workflow blueprint that governs it, to
-- prove the same engine runs a different business process end to end.
--
-- A vendor is submitted, screened by a named participant (a compliance gate),
-- then activated. The blueprint uses only the generic gates (participant
-- assignment + the append-only trace); it deliberately carries no entry/exit
-- conditions and no decision-required stage, so it exercises the engine's
-- work-type-agnostic core without depending on any CRM-specific evaluator.

CREATE TABLE platform.vendors (
  vendor_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  organization_id uuid REFERENCES platform.organizations(organization_id) ON DELETE SET NULL,
  legal_name text NOT NULL CHECK (char_length(legal_name) BETWEEN 1 AND 200),
  tax_id text,
  category text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','REJECTED')),
  blueprint_key text,
  workflow_instance_id uuid,
  stage_key text,
  owner_subject_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX vendors_tenant_idx ON platform.vendors(tenant_id, status, created_at DESC);
CREATE INDEX vendors_org_idx ON platform.vendors(organization_id) WHERE organization_id IS NOT NULL;

ALTER TABLE platform.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.vendors FORCE ROW LEVEL SECURITY;
CREATE POLICY vendors_tenant_isolation ON platform.vendors
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

-- The PLATFORM blueprint that governs vendor onboarding. Same shape as the
-- crm.case seed (0049): camelCase WorkflowStageDefinition keys the domain reads
-- back without translation. Tenant_id NULL => visible to every tenant.
INSERT INTO platform.workflow_blueprints (
  tenant_id, blueprint_key, version, label, work_type_key, source, state,
  allows_stage_addition, allows_stage_reorder, allows_stage_deactivation,
  minimum_required_stage_keys, stages, published_by_subject_id, published_at
)
SELECT
  NULL, 'vendor.onboarding', 1, 'Vendor onboarding', 'vendor.onboarding', 'PLATFORM', 'ACTIVE',
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
      "stageKey": "ACTIVE", "label": "Active", "sequence": 2, "kind": "EXECUTION",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": [], "decisionRequired": false, "decisionOutcomes": [],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "TERMINATE"
    }
  ]$json$::jsonb,
  'system', now()
WHERE NOT EXISTS (
  SELECT 1 FROM platform.workflow_blueprints
   WHERE tenant_id IS NULL AND blueprint_key = 'vendor.onboarding' AND version = 1
);

COMMIT;
