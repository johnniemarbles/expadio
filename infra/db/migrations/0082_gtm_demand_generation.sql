-- AutoGTM / Demand Generation Control Plane — platform slice.
--
-- Freeze exception 2026-08-31 (expadio#483). Maps the lab extract
-- johnniemarbles/expadio-demand-generation onto platform.* using the
-- "Adding a vertical" recipe in docs/architecture/decision-fabric-cases.md.
--
-- Binding rules this migration must not violate:
--   * Communication owns send. Connector gtm.email is seeded DISABLED.
--   * Do not register gtm-email-lab-v1. Do not add SEND_OUTBOUND.
--   * No second CRM: warm replies ingest as crm_leads.source = outbound_gtm
--     with raw_payload first. Source vocabulary is enforced in @expadio/lead,
--     not as a CHECK on existing rows.
--   * Decision Fabric gates publish/launch/meeting. No auto-approve.

-- ---------------------------------------------------------------------------
-- Lead ingest seam (existing CRM, not a new pipeline)
-- ---------------------------------------------------------------------------
ALTER TABLE platform.crm_leads
  ADD COLUMN IF NOT EXISTS raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- Subject tables (lab gtm_* → platform.gtm_*)
-- ---------------------------------------------------------------------------
CREATE TABLE platform.gtm_brand_dossiers (
  dossier_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  brand_id uuid NOT NULL,
  source_url text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gtm_brand_dossiers_tenant_idx ON platform.gtm_brand_dossiers(tenant_id, created_at DESC);

CREATE TABLE platform.gtm_icps (
  icp_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  brand_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'proposal'
    CHECK (status IN ('proposal', 'published', 'superseded', 'rejected')),
  review_status text NOT NULL DEFAULT 'unreviewed'
    CHECK (review_status IN ('unreviewed', 'in_review', 'approved', 'rejected')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  blueprint_key text,
  workflow_instance_id uuid,
  stage_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gtm_icps_tenant_idx ON platform.gtm_icps(tenant_id, status, created_at DESC);

CREATE TABLE platform.gtm_sequences (
  sequence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  brand_id uuid NOT NULL,
  icp_id uuid REFERENCES platform.gtm_icps(icp_id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'retired', 'rejected')),
  author_subject_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  blueprint_key text,
  workflow_instance_id uuid,
  stage_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gtm_sequences_tenant_idx ON platform.gtm_sequences(tenant_id, status, created_at DESC);

CREATE TABLE platform.gtm_campaigns (
  campaign_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  brand_id uuid NOT NULL,
  icp_id uuid REFERENCES platform.gtm_icps(icp_id) ON DELETE SET NULL,
  sequence_id uuid REFERENCES platform.gtm_sequences(sequence_id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_launch', 'running', 'paused', 'completed', 'rejected')),
  daily_send_cap integer NOT NULL DEFAULT 25 CHECK (daily_send_cap > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  blueprint_key text,
  workflow_instance_id uuid,
  stage_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gtm_campaigns_tenant_idx ON platform.gtm_campaigns(tenant_id, status, created_at DESC);

CREATE TABLE platform.gtm_prospect_observations (
  observation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  brand_id uuid NOT NULL,
  campaign_id uuid REFERENCES platform.gtm_campaigns(campaign_id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'observed'
    CHECK (status IN ('observed', 'suppressed', 'enqueued', 'contacted', 'replied', 'converted_capture')),
  fit_score integer NOT NULL DEFAULT 0 CHECK (fit_score BETWEEN 0 AND 100),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gtm_prospects_tenant_idx ON platform.gtm_prospect_observations(tenant_id, status, created_at DESC);

CREATE TABLE platform.gtm_reply_observations (
  reply_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  brand_id uuid NOT NULL,
  campaign_id uuid REFERENCES platform.gtm_campaigns(campaign_id) ON DELETE SET NULL,
  from_email text NOT NULL,
  proposed_class text NOT NULL
    CHECK (proposed_class IN (
      'interested', 'meeting_requested', 'not_now', 'not_a_fit',
      'unsubscribe', 'out_of_office', 'bounce', 'unknown'
    )),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gtm_replies_tenant_idx ON platform.gtm_reply_observations(tenant_id, created_at DESC);

CREATE TABLE platform.gtm_optimize_proposals (
  proposal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES platform.gtm_campaigns(campaign_id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('pause_segment', 'scale_segment', 'retire_sequence')),
  review_status text NOT NULL DEFAULT 'unreviewed'
    CHECK (review_status IN ('unreviewed', 'in_review', 'approved', 'rejected')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gtm_optimize_tenant_idx ON platform.gtm_optimize_proposals(tenant_id, review_status, created_at DESC);

CREATE TABLE platform.gtm_meeting_requests (
  meeting_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  brand_id uuid NOT NULL,
  campaign_id uuid REFERENCES platform.gtm_campaigns(campaign_id) ON DELETE SET NULL,
  reply_id uuid REFERENCES platform.gtm_reply_observations(reply_id) ON DELETE SET NULL,
  prospect_email text NOT NULL,
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 400),
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'accepted', 'rejected')),
  blueprint_key text,
  workflow_instance_id uuid,
  stage_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gtm_meeting_requests_tenant_idx ON platform.gtm_meeting_requests(tenant_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS — tenant isolation, forced, with write checks
-- ---------------------------------------------------------------------------
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'gtm_brand_dossiers',
    'gtm_icps',
    'gtm_sequences',
    'gtm_campaigns',
    'gtm_prospect_observations',
    'gtm_reply_observations',
    'gtm_optimize_proposals',
    'gtm_meeting_requests'
  ]
  LOOP
    EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE platform.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON platform.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())',
      t || '_tenant_isolation',
      t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Decision Fabric PLATFORM blueprints (four work types)
-- Review stages require a participant + APPROVE/REJECT. autoAdvance is false.
-- ---------------------------------------------------------------------------
INSERT INTO platform.workflow_blueprints (
  tenant_id, blueprint_key, version, label, work_type_key, source, state,
  allows_stage_addition, allows_stage_reorder, allows_stage_deactivation,
  minimum_required_stage_keys, stages, published_by_subject_id, published_at
)
SELECT
  NULL, 'gtm.icp.publish', 1, 'GTM ICP publish', 'gtm.icp.publish', 'PLATFORM', 'ACTIVE',
  false, false, false,
  '{}'::text[],
  $json$[
    {
      "stageKey": "PROPOSAL", "label": "Proposal", "sequence": 0, "kind": "APPLICATION",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": [], "decisionRequired": false, "decisionOutcomes": [],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "RETURN"
    },
    {
      "stageKey": "GOVERNANCE_REVIEW", "label": "Governance review", "sequence": 1, "kind": "REVIEW",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": ["gtm_reviewer"], "decisionRequired": true, "decisionOutcomes": ["APPROVE", "REJECT"],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "RETURN"
    },
    {
      "stageKey": "PUBLISHED", "label": "Published", "sequence": 2, "kind": "EXECUTION",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": [], "decisionRequired": false, "decisionOutcomes": [],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "TERMINATE"
    }
  ]$json$::jsonb,
  NULL, now();

INSERT INTO platform.workflow_blueprints (
  tenant_id, blueprint_key, version, label, work_type_key, source, state,
  allows_stage_addition, allows_stage_reorder, allows_stage_deactivation,
  minimum_required_stage_keys, stages, published_by_subject_id, published_at
)
SELECT
  NULL, 'gtm.sequence.publish', 1, 'GTM sequence publish', 'gtm.sequence.publish', 'PLATFORM', 'ACTIVE',
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
      "stageKey": "COPY_REVIEW", "label": "Copy review", "sequence": 1, "kind": "REVIEW",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": ["gtm_reviewer"], "decisionRequired": true, "decisionOutcomes": ["APPROVE", "REJECT"],
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

INSERT INTO platform.workflow_blueprints (
  tenant_id, blueprint_key, version, label, work_type_key, source, state,
  allows_stage_addition, allows_stage_reorder, allows_stage_deactivation,
  minimum_required_stage_keys, stages, published_by_subject_id, published_at
)
SELECT
  NULL, 'gtm.campaign.launch', 1, 'GTM campaign launch', 'gtm.campaign.launch', 'PLATFORM', 'ACTIVE',
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
      "stageKey": "LAUNCH_REVIEW", "label": "Launch review", "sequence": 1, "kind": "REVIEW",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": ["gtm_reviewer"], "decisionRequired": true, "decisionOutcomes": ["APPROVE", "REJECT"],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "RETURN"
    },
    {
      "stageKey": "RUNNING", "label": "Running", "sequence": 2, "kind": "EXECUTION",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": [], "decisionRequired": false, "decisionOutcomes": [],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "TERMINATE"
    }
  ]$json$::jsonb,
  NULL, now();

INSERT INTO platform.workflow_blueprints (
  tenant_id, blueprint_key, version, label, work_type_key, source, state,
  allows_stage_addition, allows_stage_reorder, allows_stage_deactivation,
  minimum_required_stage_keys, stages, published_by_subject_id, published_at
)
SELECT
  NULL, 'gtm.meeting_request', 1, 'GTM meeting request', 'gtm.meeting_request', 'PLATFORM', 'ACTIVE',
  false, false, false,
  '{}'::text[],
  $json$[
    {
      "stageKey": "REQUESTED", "label": "Requested", "sequence": 0, "kind": "APPLICATION",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": [], "decisionRequired": false, "decisionOutcomes": [],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "RETURN"
    },
    {
      "stageKey": "OWNER_REVIEW", "label": "Owner review", "sequence": 1, "kind": "REVIEW",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": ["gtm_owner"], "decisionRequired": true, "decisionOutcomes": ["APPROVE", "REJECT"],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "RETURN"
    },
    {
      "stageKey": "ACCEPTED", "label": "Accepted", "sequence": 2, "kind": "EXECUTION",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": [], "decisionRequired": false, "decisionOutcomes": [],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "TERMINATE"
    }
  ]$json$::jsonb,
  NULL, now();

-- ---------------------------------------------------------------------------
-- Communication connector gtm.email — seeded DISABLED.
-- Uses existing capability communication.email.send. Lab adapter forbidden.
-- ---------------------------------------------------------------------------
INSERT INTO platform.capabilities (capability_key, display_name, permitted_modes, enabled)
VALUES ('communication.email.send', 'Email — Send', ARRAY['A']::text[], true)
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO platform.connectors (
  connector_key, provider_type, provider_key, ownership_scope, tenant_id,
  health, priority, enabled, fallback_enabled
)
VALUES (
  'gtm.email', 'email', 'resend', 'PLATFORM', NULL,
  'UNKNOWN', 200, false, false
)
ON CONFLICT (connector_key) DO NOTHING;

INSERT INTO platform.connector_capabilities (connector_id, capability_id)
SELECT c.connector_id, cap.capability_id
  FROM platform.connectors c
  JOIN platform.capabilities cap ON cap.capability_key = 'communication.email.send'
 WHERE c.connector_key = 'gtm.email'
ON CONFLICT DO NOTHING;
