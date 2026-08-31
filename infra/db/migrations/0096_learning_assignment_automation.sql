BEGIN;

-- LMS-06 — immutable assignment-rule versions and durable per-learner
-- evaluations. Business execution still flows through the existing
-- domain-event outbox worker; this migration adds no parallel scheduler.

CREATE TABLE platform.learning_assignment_rules (
  assignment_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  academy_id uuid NOT NULL,
  rule_key text NOT NULL CHECK (
    rule_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
  ),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  current_published_version integer CHECK (
    current_published_version IS NULL OR current_published_version > 0
  ),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_rule_id, tenant_id),
  UNIQUE (tenant_id, rule_key),
  FOREIGN KEY (academy_id, tenant_id)
    REFERENCES platform.learning_academies(academy_id, tenant_id)
    ON DELETE RESTRICT
);

CREATE TABLE platform.learning_assignment_rule_versions (
  assignment_rule_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  assignment_rule_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  state text NOT NULL DEFAULT 'DRAFT'
    CHECK (state IN ('DRAFT','PUBLISHED','SUPERSEDED','ARCHIVED')),
  name text NOT NULL CHECK (btrim(name) <> ''),
  description text NOT NULL DEFAULT '',
  target_type text NOT NULL CHECK (target_type IN ('COURSE','PROGRAM')),
  course_id uuid,
  program_id uuid,
  due_days integer CHECK (due_days IS NULL OR (due_days > 0 AND due_days <= 3650)),
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(conditions) = 'object'),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by_subject_id text NOT NULL CHECK (btrim(updated_by_subject_id) <> ''),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_by_subject_id text,
  published_at timestamptz,
  UNIQUE (assignment_rule_version_id, tenant_id),
  UNIQUE (assignment_rule_version_id, tenant_id, assignment_rule_id),
  UNIQUE (assignment_rule_id, version),
  FOREIGN KEY (assignment_rule_id, tenant_id)
    REFERENCES platform.learning_assignment_rules(assignment_rule_id, tenant_id)
    ON DELETE CASCADE,
  FOREIGN KEY (course_id, tenant_id)
    REFERENCES platform.learning_courses(course_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (program_id, tenant_id)
    REFERENCES platform.learning_programs(program_id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT learning_assignment_rule_target CHECK (
    (
      target_type = 'COURSE'
      AND course_id IS NOT NULL
      AND program_id IS NULL
    )
    OR
    (
      target_type = 'PROGRAM'
      AND course_id IS NULL
      AND program_id IS NOT NULL
      AND due_days IS NULL
    )
  ),
  CONSTRAINT learning_assignment_rule_publish_metadata CHECK (
    (published_by_subject_id IS NULL AND published_at IS NULL)
    OR (published_by_subject_id IS NOT NULL AND published_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX learning_assignment_rule_one_published_uq
  ON platform.learning_assignment_rule_versions(assignment_rule_id)
  WHERE state = 'PUBLISHED';

CREATE INDEX learning_assignment_rule_published_target_idx
  ON platform.learning_assignment_rule_versions(
    tenant_id, target_type, state
  );

CREATE TABLE platform.learning_assignment_rule_executions (
  assignment_rule_execution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  assignment_rule_version_id uuid NOT NULL,
  learner_id uuid NOT NULL,
  trigger_event_id uuid,
  outcome text NOT NULL CHECK (
    outcome IN ('NOT_MATCHED','ASSIGNED','SATISFIED')
  ),
  target_type text NOT NULL CHECK (target_type IN ('COURSE','PROGRAM')),
  enrollment_id uuid,
  program_enrollment_id uuid,
  evaluated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_rule_execution_id, tenant_id),
  UNIQUE (tenant_id, assignment_rule_version_id, learner_id),
  FOREIGN KEY (assignment_rule_version_id, tenant_id)
    REFERENCES platform.learning_assignment_rule_versions(
      assignment_rule_version_id, tenant_id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (learner_id, tenant_id)
    REFERENCES platform.learning_learners(learner_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (trigger_event_id, tenant_id)
    REFERENCES platform.domain_events(event_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (enrollment_id, tenant_id)
    REFERENCES platform.learning_enrollments(enrollment_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (program_enrollment_id, tenant_id)
    REFERENCES platform.learning_program_enrollments(
      program_enrollment_id, tenant_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT learning_assignment_rule_execution_shape CHECK (
    (outcome = 'NOT_MATCHED' AND enrollment_id IS NULL AND program_enrollment_id IS NULL)
    OR
    (
      outcome IN ('ASSIGNED','SATISFIED')
      AND (
        (target_type = 'COURSE' AND enrollment_id IS NOT NULL AND program_enrollment_id IS NULL)
        OR
        (target_type = 'PROGRAM' AND enrollment_id IS NULL AND program_enrollment_id IS NOT NULL)
      )
    )
  )
);

CREATE INDEX learning_assignment_rule_executions_learner_idx
  ON platform.learning_assignment_rule_executions(
    tenant_id, learner_id, evaluated_at DESC
  );

CREATE OR REPLACE FUNCTION platform.enforce_learning_assignment_rule_version_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_ready boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'DRAFT' THEN
      RAISE EXCEPTION 'non-draft learning assignment rule versions are immutable'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.assignment_rule_id IS DISTINCT FROM NEW.assignment_rule_id
     OR OLD.version IS DISTINCT FROM NEW.version THEN
    RAISE EXCEPTION 'learning assignment rule version identity is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state <> 'DRAFT' AND (
       OLD.name IS DISTINCT FROM NEW.name
       OR OLD.description IS DISTINCT FROM NEW.description
       OR OLD.target_type IS DISTINCT FROM NEW.target_type
       OR OLD.course_id IS DISTINCT FROM NEW.course_id
       OR OLD.program_id IS DISTINCT FROM NEW.program_id
       OR OLD.due_days IS DISTINCT FROM NEW.due_days
       OR OLD.conditions IS DISTINCT FROM NEW.conditions
     ) THEN
    RAISE EXCEPTION 'only draft learning assignment rule versions may edit policy'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state = 'PUBLISHED'
     AND (NEW.published_by_subject_id IS NULL OR NEW.published_at IS NULL) THEN
    RAISE EXCEPTION 'published learning assignment rules require publication provenance'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state = 'DRAFT' AND NEW.state NOT IN ('DRAFT','PUBLISHED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning assignment rule version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'PUBLISHED' AND NEW.state NOT IN ('PUBLISHED','SUPERSEDED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning assignment rule version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'SUPERSEDED' AND NEW.state NOT IN ('SUPERSEDED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning assignment rule version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'ARCHIVED' AND NEW.state <> 'ARCHIVED' THEN
    RAISE EXCEPTION 'archived learning assignment rule versions are terminal'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state = 'PUBLISHED' AND OLD.state <> 'PUBLISHED' THEN
    IF NEW.target_type = 'COURSE' THEN
      SELECT EXISTS (
        SELECT 1
          FROM platform.learning_courses course
         WHERE course.tenant_id = NEW.tenant_id
           AND course.course_id = NEW.course_id
           AND course.status = 'ACTIVE'
           AND course.current_published_version IS NOT NULL
      ) INTO target_ready;
    ELSE
      SELECT EXISTS (
        SELECT 1
          FROM platform.learning_programs program
         WHERE program.tenant_id = NEW.tenant_id
           AND program.program_id = NEW.program_id
           AND program.status = 'ACTIVE'
           AND program.current_published_version IS NOT NULL
      ) INTO target_ready;
    END IF;

    IF target_ready IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'published learning assignment rules require an active published target'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_assignment_rule_versions_lifecycle
BEFORE UPDATE OR DELETE ON platform.learning_assignment_rule_versions
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_assignment_rule_version_lifecycle();

CREATE OR REPLACE FUNCTION platform.enforce_learning_assignment_execution_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'learning assignment rule executions are append-only'
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER learning_assignment_rule_executions_append_only
BEFORE UPDATE OR DELETE ON platform.learning_assignment_rule_executions
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_assignment_execution_immutable();

ALTER TABLE platform.learning_assignment_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_assignment_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_assignment_rules_tenant_isolation
  ON platform.learning_assignment_rules
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_assignment_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_assignment_rule_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_assignment_rule_versions_tenant_isolation
  ON platform.learning_assignment_rule_versions
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_assignment_rule_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_assignment_rule_executions FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_assignment_rule_executions_tenant_isolation
  ON platform.learning_assignment_rule_executions
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
