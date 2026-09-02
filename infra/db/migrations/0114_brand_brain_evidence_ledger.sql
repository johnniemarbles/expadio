-- Phase 2: tenant-private Brand Brain evidence ledger.
-- Observations are append-only facts; insights are governed projections.
CREATE TABLE IF NOT EXISTS platform.brand_brain_observations (
  observation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('CALL','CONVERSATION','DECISION','TASK','MOVEMENT','OUTCOME','DOCUMENT','CORRECTION')),
  source_ref text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  created_by_subject_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS platform.brand_brain_evidence (
  evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  observation_id uuid NOT NULL REFERENCES platform.brand_brain_observations(observation_id),
  evidence_type text NOT NULL CHECK (evidence_type IN ('TRANSCRIPT','MESSAGE','DECISION_RECORD','TASK_RECORD','DOCUMENT','METRIC','CORRECTION')),
  content_digest text NOT NULL,
  locator jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  captured_by_subject_id text NOT NULL,
  UNIQUE (tenant_id, observation_id, content_digest)
);

CREATE TABLE IF NOT EXISTS platform.brand_brain_insights (
  insight_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  insight_key text NOT NULL,
  statement text NOT NULL,
  confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','REVIEWED','PUBLISHED','REJECTED','SUPERSEDED')),
  model_name text NOT NULL,
  model_version text NOT NULL,
  evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  correction_of_insight_id uuid REFERENCES platform.brand_brain_insights(insight_id),
  created_by_subject_id text NOT NULL,
  reviewed_by_subject_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (tenant_id, insight_key, model_name, model_version)
);

CREATE INDEX IF NOT EXISTS brand_brain_observations_tenant_occurred_idx
  ON platform.brand_brain_observations (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS brand_brain_evidence_tenant_observation_idx
  ON platform.brand_brain_evidence (tenant_id, observation_id);
CREATE INDEX IF NOT EXISTS brand_brain_insights_tenant_status_idx
  ON platform.brand_brain_insights (tenant_id, status, created_at DESC);

ALTER TABLE platform.brand_brain_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.brand_brain_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.brand_brain_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.brand_brain_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.brand_brain_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.brand_brain_insights FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brand_brain_observations_tenant_isolation ON platform.brand_brain_observations;
CREATE POLICY brand_brain_observations_tenant_isolation ON platform.brand_brain_observations
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS brand_brain_evidence_tenant_isolation ON platform.brand_brain_evidence;
CREATE POLICY brand_brain_evidence_tenant_isolation ON platform.brand_brain_evidence
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS brand_brain_insights_tenant_isolation ON platform.brand_brain_insights;
CREATE POLICY brand_brain_insights_tenant_isolation ON platform.brand_brain_insights
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE platform.brand_brain_observations IS 'Tenant-private, append-only neutral observations for Brand Brain learning.';
COMMENT ON TABLE platform.brand_brain_evidence IS 'Tenant-private provenance attached to Brand Brain observations.';
COMMENT ON TABLE platform.brand_brain_insights IS 'Tenant-private governed insights; no cross-tenant learning is implied.';
