-- Fifth Decision Fabric vertical: social content publish approval.
--
-- Follows the "Adding a vertical" recipe in docs/architecture/decision-fabric-cases.md.
-- Same pattern as access.request: role + separation of duties only (no monetary
-- authority deriver). A brand_approver who is not the content author must APPROVE
-- before the subject can reach APPROVED; publish execution is gated on that stage.
--
-- Connectors / AI / media live in the separate expadio-social-content module;
-- this migration only adds the governed subject + PLATFORM blueprint.

CREATE TABLE platform.social_content_items (
  content_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  author_subject_id text,
  title text,
  body text NOT NULL DEFAULT '',
  media_urls text[] NOT NULL DEFAULT '{}',
  platforms text[] NOT NULL DEFAULT '{}',
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai_generated')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SCHEDULED', 'PUBLISHED', 'FAILED'
  )),
  ai_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Decision Fabric binding seam — identical to crm_cases/vendors/expenses/access_requests.
  blueprint_key text,
  workflow_instance_id uuid,
  stage_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX social_content_items_tenant_idx
  ON platform.social_content_items(tenant_id, status, created_at DESC);

ALTER TABLE platform.social_content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.social_content_items FORCE ROW LEVEL SECURITY;
CREATE POLICY social_content_items_tenant_isolation ON platform.social_content_items
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

-- PLATFORM blueprint: every tenant binds to it (tenant_id NULL).
INSERT INTO platform.workflow_blueprints (
  tenant_id, blueprint_key, version, label, work_type_key, source, state,
  allows_stage_addition, allows_stage_reorder, allows_stage_deactivation,
  minimum_required_stage_keys, stages, published_by_subject_id, published_at
)
SELECT
  NULL, 'social.content_publish', 1, 'Social content publish', 'social.content_publish', 'PLATFORM', 'ACTIVE',
  false, false, false,
  '{}'::text[],
  $json$[
    {
      "stageKey": "DRAFT", "label": "Draft", "sequence": 0, "kind": "APPLICATION",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": [], "decisionRequired": false, "decisionOutcomes": [],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "RETURN"
    },
    {
      "stageKey": "BRAND_REVIEW", "label": "Brand review", "sequence": 1, "kind": "REVIEW",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": ["brand_approver"], "decisionRequired": true, "decisionOutcomes": ["APPROVE", "REJECT"],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "RETURN"
    },
    {
      "stageKey": "APPROVED", "label": "Approved", "sequence": 2, "kind": "EXECUTION",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": [], "decisionRequired": false, "decisionOutcomes": [],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "TERMINATE"
    }
  ]$json$::jsonb,
  NULL, now();
