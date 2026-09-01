BEGIN;

-- LMS-08 / horizontal AI execution durability.
--
-- Immutable AI jobs continue to carry references only. Prompt/context/output
-- content lives in tenant-scoped artifacts, while mutable lease/retry state
-- lives in a separate execution queue.

CREATE TABLE platform.ai_job_artifacts (
  artifact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  artifact_type text NOT NULL CHECK (
    artifact_type IN ('INPUT','CONTEXT','OUTPUT')
  ),
  media_type text NOT NULL DEFAULT 'text/plain'
    CHECK (btrim(media_type) <> ''),
  content text NOT NULL CHECK (btrim(content) <> ''),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  FOREIGN KEY (job_id, tenant_id)
    REFERENCES platform.ai_jobs(job_id, tenant_id) ON DELETE RESTRICT,
  UNIQUE (artifact_id, tenant_id)
);

CREATE INDEX ai_job_artifacts_job_idx
  ON platform.ai_job_artifacts(tenant_id, job_id, artifact_type, created_at);

CREATE TABLE platform.ai_job_execution_queue (
  queue_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING','CLAIMED','COMPLETED','FAILED','DEAD','CANCELLED')
  ),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  claimed_at timestamptz,
  claim_token uuid,
  claim_expires_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (job_id, tenant_id)
    REFERENCES platform.ai_jobs(job_id, tenant_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, job_id),
  CHECK (
    (status = 'CLAIMED'
      AND claimed_at IS NOT NULL
      AND claim_token IS NOT NULL
      AND claim_expires_at IS NOT NULL)
    OR
    (status <> 'CLAIMED'
      AND claimed_at IS NULL
      AND claim_token IS NULL
      AND claim_expires_at IS NULL)
  )
);

CREATE INDEX ai_job_execution_queue_due_idx
  ON platform.ai_job_execution_queue(
    tenant_id, status, available_at, created_at, queue_id
  );

CREATE OR REPLACE FUNCTION platform.reject_ai_job_artifact_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AI job artifacts are immutable';
END;
$$;

CREATE TRIGGER ai_job_artifacts_immutable
BEFORE UPDATE OR DELETE ON platform.ai_job_artifacts
FOR EACH ROW EXECUTE FUNCTION platform.reject_ai_job_artifact_mutation();

ALTER TABLE platform.ai_job_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_job_artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_job_execution_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_job_execution_queue FORCE ROW LEVEL SECURITY;

CREATE POLICY ai_job_artifacts_select
  ON platform.ai_job_artifacts
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY ai_job_artifacts_insert
  ON platform.ai_job_artifacts
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY ai_job_execution_queue_tenant_isolation
  ON platform.ai_job_execution_queue
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
