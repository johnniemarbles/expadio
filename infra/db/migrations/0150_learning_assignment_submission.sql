BEGIN;

-- LMS-15 — immutable assignment definitions, learner submissions and manual grading.

CREATE TABLE platform.learning_assignments (
  assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  academy_id uuid NOT NULL,
  assignment_key text NOT NULL CHECK (assignment_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  current_published_version integer CHECK (current_published_version IS NULL OR current_published_version > 0),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, tenant_id),
  UNIQUE (tenant_id, assignment_key),
  FOREIGN KEY (academy_id, tenant_id)
    REFERENCES platform.learning_academies(academy_id, tenant_id) ON DELETE RESTRICT
);

CREATE TABLE platform.learning_assignment_versions (
  assignment_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','PUBLISHED','SUPERSEDED','ARCHIVED')),
  title text NOT NULL CHECK (btrim(title) <> ''),
  instructions text NOT NULL DEFAULT '',
  course_version_id uuid NOT NULL,
  max_points numeric(12,2) NOT NULL CHECK (max_points > 0),
  allow_text boolean NOT NULL DEFAULT true,
  allow_attachments boolean NOT NULL DEFAULT false,
  max_attachments integer NOT NULL DEFAULT 0 CHECK (max_attachments BETWEEN 0 AND 20),
  due_at timestamptz,
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by_subject_id text NOT NULL CHECK (btrim(updated_by_subject_id) <> ''),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_by_subject_id text,
  published_at timestamptz,
  UNIQUE (assignment_version_id, tenant_id),
  UNIQUE (assignment_version_id, tenant_id, assignment_id),
  UNIQUE (assignment_id, version),
  FOREIGN KEY (assignment_id, tenant_id)
    REFERENCES platform.learning_assignments(assignment_id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (course_version_id, tenant_id)
    REFERENCES platform.learning_course_versions(course_version_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT learning_assignment_input_required CHECK (allow_text OR allow_attachments),
  CONSTRAINT learning_assignment_attachment_shape CHECK (
    (allow_attachments AND max_attachments > 0) OR (NOT allow_attachments AND max_attachments = 0)
  ),
  CONSTRAINT learning_assignment_publish_metadata CHECK (
    (published_by_subject_id IS NULL AND published_at IS NULL)
    OR (published_by_subject_id IS NOT NULL AND published_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX learning_assignment_one_published_uq
  ON platform.learning_assignment_versions(assignment_id) WHERE state = 'PUBLISHED';

CREATE TABLE platform.learning_assignment_submissions (
  submission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL,
  assignment_version_id uuid NOT NULL,
  learner_id uuid NOT NULL,
  enrollment_id uuid NOT NULL,
  course_version_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  submission_key text NOT NULL CHECK (btrim(submission_key) <> ''),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  status text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','RETURNED','GRADED','VOID')),
  response_text text NOT NULL DEFAULT '',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  graded_at timestamptz,
  graded_by_subject_id text,
  score_points numeric(12,2),
  feedback text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, tenant_id),
  UNIQUE (tenant_id, submission_key),
  UNIQUE (tenant_id, learner_id, assignment_version_id, attempt_number),
  FOREIGN KEY (assignment_version_id, tenant_id, assignment_id)
    REFERENCES platform.learning_assignment_versions(assignment_version_id, tenant_id, assignment_id) ON DELETE RESTRICT,
  FOREIGN KEY (learner_id, tenant_id)
    REFERENCES platform.learning_learners(learner_id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (enrollment_id, tenant_id, learner_id, course_version_id)
    REFERENCES platform.learning_enrollments(enrollment_id, tenant_id, learner_id, course_version_id) ON DELETE RESTRICT,
  FOREIGN KEY (lesson_id, tenant_id)
    REFERENCES platform.learning_lessons(lesson_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT learning_assignment_grade_shape CHECK (
    (status = 'GRADED' AND graded_at IS NOT NULL AND graded_by_subject_id IS NOT NULL AND score_points IS NOT NULL)
    OR status <> 'GRADED'
  ),
  CONSTRAINT learning_assignment_return_shape CHECK (
    status <> 'RETURNED' OR (graded_at IS NOT NULL AND graded_by_subject_id IS NOT NULL AND btrim(feedback) <> '')
  )
);

CREATE TABLE platform.learning_assignment_submission_assets (
  submission_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  position integer NOT NULL CHECK (position > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_id, asset_id),
  UNIQUE (submission_id, position),
  FOREIGN KEY (submission_id, tenant_id)
    REFERENCES platform.learning_assignment_submissions(submission_id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id, tenant_id, organization_id)
    REFERENCES platform.content_assets(asset_id, tenant_id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE platform.learning_assignment_grade_events (
  grade_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  submission_id uuid NOT NULL,
  from_status text NOT NULL CHECK (from_status IN ('SUBMITTED','RETURNED','GRADED')),
  to_status text NOT NULL CHECK (to_status IN ('RETURNED','GRADED')),
  score_points numeric(12,2),
  feedback text NOT NULL DEFAULT '',
  actor_subject_id text NOT NULL CHECK (btrim(actor_subject_id) <> ''),
  correlation_id text NOT NULL CHECK (btrim(correlation_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (submission_id, tenant_id)
    REFERENCES platform.learning_assignment_submissions(submission_id, tenant_id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION platform.enforce_learning_assignment_version_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'DRAFT' THEN RAISE EXCEPTION 'non-draft assignment versions are immutable' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.assignment_id IS DISTINCT FROM NEW.assignment_id
     OR OLD.version IS DISTINCT FROM NEW.version THEN
    RAISE EXCEPTION 'assignment version identity is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state <> 'DRAFT' AND (
    OLD.title IS DISTINCT FROM NEW.title OR OLD.instructions IS DISTINCT FROM NEW.instructions
    OR OLD.course_version_id IS DISTINCT FROM NEW.course_version_id
    OR OLD.max_points IS DISTINCT FROM NEW.max_points OR OLD.allow_text IS DISTINCT FROM NEW.allow_text
    OR OLD.allow_attachments IS DISTINCT FROM NEW.allow_attachments
    OR OLD.max_attachments IS DISTINCT FROM NEW.max_attachments OR OLD.due_at IS DISTINCT FROM NEW.due_at
  ) THEN RAISE EXCEPTION 'only draft assignment versions may edit content' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.state = 'PUBLISHED' AND (NEW.published_by_subject_id IS NULL OR NEW.published_at IS NULL) THEN
    RAISE EXCEPTION 'published assignment versions require publication provenance' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state = 'DRAFT' AND NEW.state NOT IN ('DRAFT','PUBLISHED','ARCHIVED')
     OR OLD.state = 'PUBLISHED' AND NEW.state NOT IN ('PUBLISHED','SUPERSEDED','ARCHIVED')
     OR OLD.state = 'SUPERSEDED' AND NEW.state NOT IN ('SUPERSEDED','ARCHIVED')
     OR OLD.state = 'ARCHIVED' AND NEW.state <> 'ARCHIVED' THEN
    RAISE EXCEPTION 'invalid assignment version transition' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER learning_assignment_versions_lifecycle
BEFORE UPDATE OR DELETE ON platform.learning_assignment_versions
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_assignment_version_lifecycle();

CREATE OR REPLACE FUNCTION platform.prevent_learning_assignment_grade_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'assignment grade events are append-only' USING ERRCODE = 'check_violation';
END; $$;

CREATE TRIGGER learning_assignment_grade_events_append_only
BEFORE UPDATE OR DELETE ON platform.learning_assignment_grade_events
FOR EACH ROW EXECUTE FUNCTION platform.prevent_learning_assignment_grade_event_mutation();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'learning_assignments','learning_assignment_versions','learning_assignment_submissions',
    'learning_assignment_submission_assets','learning_assignment_grade_events'
  ] LOOP
    EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE platform.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON platform.%I FOR ALL USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())',
      table_name || '_tenant_isolation', table_name
    );
  END LOOP;
END; $$;

COMMIT;
