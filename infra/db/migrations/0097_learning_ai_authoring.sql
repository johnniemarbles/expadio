BEGIN;

-- LMS-07 — reusable immutable AI output persistence plus Learning-specific
-- brief-to-course proposals and explicit human decisions.

CREATE TABLE platform.ai_generated_outputs (
  output_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  invocation_id text NOT NULL CHECK (btrim(invocation_id) <> ''),
  connector_key text NOT NULL CHECK (btrim(connector_key) <> ''),
  provider_key text NOT NULL CHECK (btrim(provider_key) <> ''),
  model_key text NOT NULL CHECK (btrim(model_key) <> ''),
  media_type text NOT NULL CHECK (btrim(media_type) <> ''),
  content text NOT NULL CHECK (content <> ''),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  generated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (output_id, tenant_id),
  UNIQUE (tenant_id, invocation_id)
);

CREATE TABLE platform.learning_ai_course_proposal_requests (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  request_key text NOT NULL CHECK (
    request_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  course_key text NOT NULL CHECK (
    course_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
  ),
  brief text NOT NULL CHECK (
    btrim(brief) <> '' AND char_length(brief) <= 50000
  ),
  language text NOT NULL CHECK (btrim(language) <> ''),
  visibility text NOT NULL CHECK (visibility IN ('PRIVATE','TENANT','PUBLIC')),
  prompt_configuration_key text NOT NULL
    CHECK (btrim(prompt_configuration_key) <> ''),
  prompt_configuration_version integer NOT NULL
    CHECK (prompt_configuration_version > 0),
  required_residency_tags text[] NOT NULL DEFAULT '{}'
    CHECK (array_position(required_residency_tags, NULL) IS NULL),
  required_compliance_tags text[] NOT NULL DEFAULT '{}'
    CHECK (array_position(required_compliance_tags, NULL) IS NULL),
  maximum_cost_minor_units integer
    CHECK (maximum_cost_minor_units IS NULL OR maximum_cost_minor_units >= 0),
  requested_by_subject_id text NOT NULL
    CHECK (btrim(requested_by_subject_id) <> ''),
  requested_at timestamptz NOT NULL,
  correlation_id text NOT NULL CHECK (btrim(correlation_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, tenant_id),
  UNIQUE (tenant_id, request_key)
);

CREATE TABLE platform.learning_ai_course_proposals (
  proposal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  ai_output_reference text NOT NULL CHECK (btrim(ai_output_reference) <> ''),
  course_draft jsonb NOT NULL CHECK (jsonb_typeof(course_draft) = 'object'),
  confidence double precision CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  ),
  connector_key text NOT NULL CHECK (btrim(connector_key) <> ''),
  provider_key text NOT NULL CHECK (btrim(provider_key) <> ''),
  model_key text NOT NULL CHECK (btrim(model_key) <> ''),
  prompt_configuration_key text NOT NULL
    CHECK (btrim(prompt_configuration_key) <> ''),
  prompt_configuration_version integer NOT NULL
    CHECK (prompt_configuration_version > 0),
  source_references text[] NOT NULL CHECK (
    cardinality(source_references) > 0
    AND array_position(source_references, NULL) IS NULL
  ),
  cost_minor_units integer CHECK (
    cost_minor_units IS NULL OR cost_minor_units >= 0
  ),
  generated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, tenant_id),
  UNIQUE (tenant_id, request_id),
  FOREIGN KEY (request_id, tenant_id)
    REFERENCES platform.learning_ai_course_proposal_requests(
      request_id, tenant_id
    )
    ON DELETE RESTRICT
);

CREATE TABLE platform.learning_ai_course_proposal_decisions (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('ACCEPTED','REJECTED')),
  materialized_course_id uuid,
  decided_by_subject_id text NOT NULL
    CHECK (btrim(decided_by_subject_id) <> ''),
  reason text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 4000),
  decided_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (decision_id, tenant_id),
  UNIQUE (tenant_id, proposal_id),
  FOREIGN KEY (proposal_id, tenant_id)
    REFERENCES platform.learning_ai_course_proposals(proposal_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (materialized_course_id, tenant_id)
    REFERENCES platform.learning_courses(course_id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT learning_ai_course_decision_shape CHECK (
    (decision = 'ACCEPTED' AND materialized_course_id IS NOT NULL)
    OR
    (decision = 'REJECTED' AND materialized_course_id IS NULL)
  )
);

CREATE INDEX learning_ai_course_requests_tenant_created_idx
  ON platform.learning_ai_course_proposal_requests(
    tenant_id, requested_at DESC, request_id
  );

CREATE INDEX learning_ai_course_proposals_tenant_created_idx
  ON platform.learning_ai_course_proposals(
    tenant_id, generated_at DESC, proposal_id
  );

CREATE OR REPLACE FUNCTION platform.reject_ai_generated_output_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AI generated outputs are immutable'
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER ai_generated_outputs_immutable
BEFORE UPDATE OR DELETE ON platform.ai_generated_outputs
FOR EACH ROW EXECUTE FUNCTION platform.reject_ai_generated_output_mutation();

CREATE OR REPLACE FUNCTION platform.reject_learning_ai_authoring_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Learning AI authoring history is immutable'
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER learning_ai_course_requests_immutable
BEFORE UPDATE OR DELETE ON platform.learning_ai_course_proposal_requests
FOR EACH ROW EXECUTE FUNCTION platform.reject_learning_ai_authoring_history_mutation();

CREATE TRIGGER learning_ai_course_proposals_immutable
BEFORE UPDATE OR DELETE ON platform.learning_ai_course_proposals
FOR EACH ROW EXECUTE FUNCTION platform.reject_learning_ai_authoring_history_mutation();

CREATE TRIGGER learning_ai_course_decisions_immutable
BEFORE UPDATE OR DELETE ON platform.learning_ai_course_proposal_decisions
FOR EACH ROW EXECUTE FUNCTION platform.reject_learning_ai_authoring_history_mutation();

ALTER TABLE platform.ai_generated_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_generated_outputs FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_generated_outputs_tenant_isolation
  ON platform.ai_generated_outputs
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_ai_course_proposal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_ai_course_proposal_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_ai_course_requests_tenant_isolation
  ON platform.learning_ai_course_proposal_requests
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_ai_course_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_ai_course_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_ai_course_proposals_tenant_isolation
  ON platform.learning_ai_course_proposals
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_ai_course_proposal_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_ai_course_proposal_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_ai_course_decisions_tenant_isolation
  ON platform.learning_ai_course_proposal_decisions
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
