BEGIN;

-- LMS-08 — Learning consumes the horizontal durable AI job runtime.
-- This table is immutable linkage/audit context only; AI execution state remains
-- authoritative in platform.ai_jobs + platform.ai_job_events.

CREATE TABLE platform.learning_ai_requests (
  learning_ai_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  request_type text NOT NULL CHECK (
    request_type IN ('TUTOR','AUTHOR_DRAFT','ASSESSMENT_FEEDBACK','COACH')
  ),
  learner_id uuid,
  course_id uuid,
  course_version_id uuid,
  requested_by_subject_id text NOT NULL
    CHECK (btrim(requested_by_subject_id) <> ''),
  prompt_key text NOT NULL CHECK (btrim(prompt_key) <> ''),
  prompt_version integer NOT NULL CHECK (prompt_version > 0),
  input_artifact_id uuid NOT NULL,
  context_artifact_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  correlation_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  FOREIGN KEY (job_id, tenant_id)
    REFERENCES platform.ai_jobs(job_id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (input_artifact_id, tenant_id)
    REFERENCES platform.ai_job_artifacts(artifact_id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (context_artifact_id, tenant_id)
    REFERENCES platform.ai_job_artifacts(artifact_id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (learner_id, tenant_id)
    REFERENCES platform.learning_learners(learner_id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (course_id, tenant_id)
    REFERENCES platform.learning_courses(course_id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (course_version_id, tenant_id)
    REFERENCES platform.learning_course_versions(course_version_id, tenant_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, job_id)
);

CREATE INDEX learning_ai_requests_subject_idx
  ON platform.learning_ai_requests(
    tenant_id, requested_by_subject_id, created_at DESC
  );

CREATE INDEX learning_ai_requests_learner_idx
  ON platform.learning_ai_requests(
    tenant_id, learner_id, created_at DESC
  )
  WHERE learner_id IS NOT NULL;

CREATE OR REPLACE FUNCTION platform.reject_learning_ai_request_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Learning AI request linkage is immutable';
END;
$$;

CREATE TRIGGER learning_ai_requests_immutable
BEFORE UPDATE OR DELETE ON platform.learning_ai_requests
FOR EACH ROW EXECUTE FUNCTION platform.reject_learning_ai_request_mutation();

ALTER TABLE platform.learning_ai_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_ai_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY learning_ai_requests_tenant_isolation
  ON platform.learning_ai_requests
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
