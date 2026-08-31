BEGIN;

-- LMS-03 — reusable question banks, immutable published assessments, pinned
-- attempts, deterministic auto-grading evidence.

ALTER TABLE platform.learning_enrollments
  ADD CONSTRAINT learning_enrollments_attempt_identity_uq
  UNIQUE (enrollment_id, tenant_id, learner_id, course_version_id);

CREATE TABLE platform.learning_question_banks (
  question_bank_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  academy_id uuid NOT NULL,
  bank_key text NOT NULL CHECK (bank_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_bank_id, tenant_id),
  UNIQUE (tenant_id, bank_key),
  FOREIGN KEY (academy_id, tenant_id)
    REFERENCES platform.learning_academies(academy_id, tenant_id)
    ON DELETE RESTRICT
);

CREATE TABLE platform.learning_questions (
  question_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  question_bank_id uuid NOT NULL,
  question_key text NOT NULL CHECK (question_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  current_published_version integer CHECK (current_published_version IS NULL OR current_published_version > 0),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id, tenant_id),
  UNIQUE (question_bank_id, question_key),
  FOREIGN KEY (question_bank_id, tenant_id)
    REFERENCES platform.learning_question_banks(question_bank_id, tenant_id)
    ON DELETE RESTRICT
);

CREATE TABLE platform.learning_question_versions (
  question_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  question_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  state text NOT NULL DEFAULT 'DRAFT'
    CHECK (state IN ('DRAFT','PUBLISHED','SUPERSEDED','ARCHIVED')),
  question_type text NOT NULL
    CHECK (question_type IN ('SINGLE_CHOICE','MULTIPLE_CHOICE','TRUE_FALSE')),
  prompt text NOT NULL CHECK (btrim(prompt) <> ''),
  options jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array'),
  answer_key jsonb NOT NULL CHECK (jsonb_typeof(answer_key) = 'object'),
  explanation text NOT NULL DEFAULT '',
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by_subject_id text NOT NULL CHECK (btrim(updated_by_subject_id) <> ''),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_by_subject_id text,
  published_at timestamptz,
  UNIQUE (question_version_id, tenant_id),
  UNIQUE (question_version_id, tenant_id, question_id),
  UNIQUE (question_id, version),
  FOREIGN KEY (question_id, tenant_id)
    REFERENCES platform.learning_questions(question_id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT learning_question_publish_metadata CHECK (
    (published_by_subject_id IS NULL AND published_at IS NULL)
    OR (published_by_subject_id IS NOT NULL AND published_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX learning_question_one_published_uq
  ON platform.learning_question_versions(question_id)
  WHERE state = 'PUBLISHED';

CREATE TABLE platform.learning_assessments (
  assessment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  academy_id uuid NOT NULL,
  assessment_key text NOT NULL CHECK (assessment_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  current_published_version integer CHECK (current_published_version IS NULL OR current_published_version > 0),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, tenant_id),
  UNIQUE (tenant_id, assessment_key),
  FOREIGN KEY (academy_id, tenant_id)
    REFERENCES platform.learning_academies(academy_id, tenant_id)
    ON DELETE RESTRICT
);

CREATE TABLE platform.learning_assessment_versions (
  assessment_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  state text NOT NULL DEFAULT 'DRAFT'
    CHECK (state IN ('DRAFT','PUBLISHED','SUPERSEDED','ARCHIVED')),
  title text NOT NULL CHECK (btrim(title) <> ''),
  instructions text NOT NULL DEFAULT '',
  assessment_type text NOT NULL DEFAULT 'QUIZ'
    CHECK (assessment_type IN ('QUIZ','EXAM','PRACTICE')),
  pass_percent numeric(5,2) NOT NULL DEFAULT 70 CHECK (pass_percent >= 0 AND pass_percent <= 100),
  max_attempts integer NOT NULL DEFAULT 1 CHECK (max_attempts > 0 AND max_attempts <= 100),
  time_limit_seconds integer CHECK (time_limit_seconds IS NULL OR (time_limit_seconds > 0 AND time_limit_seconds <= 604800)),
  course_version_id uuid,
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by_subject_id text NOT NULL CHECK (btrim(updated_by_subject_id) <> ''),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_by_subject_id text,
  published_at timestamptz,
  UNIQUE (assessment_version_id, tenant_id),
  UNIQUE (assessment_version_id, tenant_id, assessment_id),
  UNIQUE (assessment_id, version),
  FOREIGN KEY (assessment_id, tenant_id)
    REFERENCES platform.learning_assessments(assessment_id, tenant_id)
    ON DELETE CASCADE,
  FOREIGN KEY (course_version_id, tenant_id)
    REFERENCES platform.learning_course_versions(course_version_id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT learning_assessment_publish_metadata CHECK (
    (published_by_subject_id IS NULL AND published_at IS NULL)
    OR (published_by_subject_id IS NOT NULL AND published_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX learning_assessment_one_published_uq
  ON platform.learning_assessment_versions(assessment_id)
  WHERE state = 'PUBLISHED';

CREATE TABLE platform.learning_assessment_items (
  assessment_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  assessment_version_id uuid NOT NULL,
  question_version_id uuid NOT NULL,
  position integer NOT NULL CHECK (position > 0),
  points numeric(10,2) NOT NULL CHECK (points > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_item_id, tenant_id),
  UNIQUE (assessment_version_id, position),
  UNIQUE (assessment_version_id, question_version_id),
  FOREIGN KEY (assessment_version_id, tenant_id)
    REFERENCES platform.learning_assessment_versions(assessment_version_id, tenant_id)
    ON DELETE CASCADE,
  FOREIGN KEY (question_version_id, tenant_id)
    REFERENCES platform.learning_question_versions(question_version_id, tenant_id)
    ON DELETE RESTRICT
);

CREATE TABLE platform.learning_assessment_attempts (
  attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL,
  assessment_version_id uuid NOT NULL,
  learner_id uuid NOT NULL,
  enrollment_id uuid,
  course_version_id uuid,
  attempt_key text NOT NULL CHECK (btrim(attempt_key) <> ''),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  status text NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (status IN ('IN_PROGRESS','GRADED','VOID')),
  started_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz,
  submitted_at timestamptz,
  graded_at timestamptz,
  score_points numeric(12,2),
  max_points numeric(12,2),
  score_percent numeric(5,2),
  passed boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, tenant_id),
  UNIQUE (attempt_id, tenant_id, assessment_version_id),
  UNIQUE (tenant_id, attempt_key),
  UNIQUE (tenant_id, learner_id, assessment_version_id, attempt_number),
  FOREIGN KEY (assessment_version_id, tenant_id, assessment_id)
    REFERENCES platform.learning_assessment_versions(assessment_version_id, tenant_id, assessment_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (learner_id, tenant_id)
    REFERENCES platform.learning_learners(learner_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (enrollment_id, tenant_id, learner_id, course_version_id)
    REFERENCES platform.learning_enrollments(enrollment_id, tenant_id, learner_id, course_version_id)
    ON DELETE RESTRICT,
  CONSTRAINT learning_attempt_course_binding CHECK (
    (enrollment_id IS NULL AND course_version_id IS NULL)
    OR (enrollment_id IS NOT NULL AND course_version_id IS NOT NULL)
  ),
  CONSTRAINT learning_attempt_deadline CHECK (
    deadline_at IS NULL OR deadline_at > started_at
  ),
  CONSTRAINT learning_attempt_submission_deadline CHECK (
    submitted_at IS NULL OR deadline_at IS NULL OR submitted_at <= deadline_at
  ),
  CONSTRAINT learning_attempt_grade_shape CHECK (
    (status = 'GRADED'
      AND submitted_at IS NOT NULL
      AND graded_at IS NOT NULL
      AND score_points IS NOT NULL
      AND max_points IS NOT NULL
      AND score_percent IS NOT NULL
      AND passed IS NOT NULL)
    OR status <> 'GRADED'
  )
);

CREATE INDEX learning_assessment_attempts_learner_idx
  ON platform.learning_assessment_attempts
  (tenant_id, learner_id, assessment_version_id, attempt_number DESC);

CREATE TABLE platform.learning_assessment_responses (
  response_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL,
  assessment_version_id uuid NOT NULL,
  question_version_id uuid NOT NULL,
  response jsonb NOT NULL,
  correct boolean NOT NULL,
  awarded_points numeric(10,2) NOT NULL CHECK (awarded_points >= 0),
  max_points numeric(10,2) NOT NULL CHECK (max_points > 0),
  graded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (response_id, tenant_id),
  UNIQUE (attempt_id, question_version_id),
  FOREIGN KEY (attempt_id, tenant_id, assessment_version_id)
    REFERENCES platform.learning_assessment_attempts(attempt_id, tenant_id, assessment_version_id)
    ON DELETE CASCADE,
  FOREIGN KEY (question_version_id, tenant_id)
    REFERENCES platform.learning_question_versions(question_version_id, tenant_id)
    ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION platform.enforce_learning_question_version_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'DRAFT' THEN
      RAISE EXCEPTION 'non-draft learning question versions are immutable'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.question_id IS DISTINCT FROM NEW.question_id
     OR OLD.version IS DISTINCT FROM NEW.version THEN
    RAISE EXCEPTION 'learning question version identity is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state <> 'DRAFT' AND (
       OLD.question_type IS DISTINCT FROM NEW.question_type
       OR OLD.prompt IS DISTINCT FROM NEW.prompt
       OR OLD.options IS DISTINCT FROM NEW.options
       OR OLD.answer_key IS DISTINCT FROM NEW.answer_key
       OR OLD.explanation IS DISTINCT FROM NEW.explanation
     ) THEN
    RAISE EXCEPTION 'only draft learning question versions may edit content'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state = 'DRAFT' AND NEW.state NOT IN ('DRAFT','PUBLISHED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning question version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'PUBLISHED' AND NEW.state NOT IN ('PUBLISHED','SUPERSEDED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning question version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'SUPERSEDED' AND NEW.state NOT IN ('SUPERSEDED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning question version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'ARCHIVED' AND NEW.state <> 'ARCHIVED' THEN
    RAISE EXCEPTION 'archived learning question versions are terminal'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_question_versions_lifecycle
BEFORE UPDATE OR DELETE ON platform.learning_question_versions
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_question_version_lifecycle();

CREATE OR REPLACE FUNCTION platform.enforce_learning_assessment_version_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'DRAFT' THEN
      RAISE EXCEPTION 'non-draft learning assessment versions are immutable'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.assessment_id IS DISTINCT FROM NEW.assessment_id
     OR OLD.version IS DISTINCT FROM NEW.version THEN
    RAISE EXCEPTION 'learning assessment version identity is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state <> 'DRAFT' AND (
       OLD.title IS DISTINCT FROM NEW.title
       OR OLD.instructions IS DISTINCT FROM NEW.instructions
       OR OLD.assessment_type IS DISTINCT FROM NEW.assessment_type
       OR OLD.pass_percent IS DISTINCT FROM NEW.pass_percent
       OR OLD.max_attempts IS DISTINCT FROM NEW.max_attempts
       OR OLD.time_limit_seconds IS DISTINCT FROM NEW.time_limit_seconds
       OR OLD.course_version_id IS DISTINCT FROM NEW.course_version_id
     ) THEN
    RAISE EXCEPTION 'only draft learning assessment versions may edit content'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state = 'DRAFT' AND NEW.state NOT IN ('DRAFT','PUBLISHED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning assessment version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'PUBLISHED' AND NEW.state NOT IN ('PUBLISHED','SUPERSEDED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning assessment version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'SUPERSEDED' AND NEW.state NOT IN ('SUPERSEDED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning assessment version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'ARCHIVED' AND NEW.state <> 'ARCHIVED' THEN
    RAISE EXCEPTION 'archived learning assessment versions are terminal'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state = 'PUBLISHED' AND OLD.state <> 'PUBLISHED' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM platform.learning_assessment_items item
       WHERE item.assessment_version_id = NEW.assessment_version_id
         AND item.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'published learning assessments require at least one question'
        USING ERRCODE = 'check_violation';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM platform.learning_assessment_items item
        JOIN platform.learning_question_versions q
          ON q.question_version_id = item.question_version_id
         AND q.tenant_id = item.tenant_id
       WHERE item.assessment_version_id = NEW.assessment_version_id
         AND item.tenant_id = NEW.tenant_id
         AND q.state NOT IN ('PUBLISHED','SUPERSEDED')
    ) THEN
      RAISE EXCEPTION 'published learning assessments require published question versions'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_assessment_versions_lifecycle
BEFORE UPDATE OR DELETE ON platform.learning_assessment_versions
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_assessment_version_lifecycle();

CREATE OR REPLACE FUNCTION platform.enforce_learning_assessment_item_draft()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_id uuid;
  target_tenant uuid;
  parent_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    version_id := OLD.assessment_version_id;
    target_tenant := OLD.tenant_id;
  ELSE
    version_id := NEW.assessment_version_id;
    target_tenant := NEW.tenant_id;
  END IF;

  SELECT state INTO parent_state
    FROM platform.learning_assessment_versions
   WHERE assessment_version_id = version_id
     AND tenant_id = target_tenant;

  IF parent_state IS NULL AND TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF parent_state IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'learning assessment items may mutate only while version is DRAFT'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_assessment_items_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON platform.learning_assessment_items
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_assessment_item_draft();

CREATE OR REPLACE FUNCTION platform.enforce_learning_attempt_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  assessment_state text;
  assessment_course_version uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR OLD.assessment_id IS DISTINCT FROM NEW.assessment_id
       OR OLD.assessment_version_id IS DISTINCT FROM NEW.assessment_version_id
       OR OLD.learner_id IS DISTINCT FROM NEW.learner_id
       OR OLD.enrollment_id IS DISTINCT FROM NEW.enrollment_id
       OR OLD.course_version_id IS DISTINCT FROM NEW.course_version_id
       OR OLD.attempt_key IS DISTINCT FROM NEW.attempt_key
       OR OLD.attempt_number IS DISTINCT FROM NEW.attempt_number THEN
      RAISE EXCEPTION 'learning assessment attempt identity is immutable'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT state, course_version_id
    INTO assessment_state, assessment_course_version
    FROM platform.learning_assessment_versions
   WHERE assessment_version_id = NEW.assessment_version_id
     AND tenant_id = NEW.tenant_id
     AND assessment_id = NEW.assessment_id;

  IF assessment_state IS DISTINCT FROM 'PUBLISHED' THEN
    RAISE EXCEPTION 'new learning assessment attempts require a published assessment version'
      USING ERRCODE = 'check_violation';
  END IF;

  IF assessment_course_version IS NULL THEN
    IF NEW.enrollment_id IS NOT NULL OR NEW.course_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'standalone learning assessment attempts cannot bind an enrollment'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.enrollment_id IS NULL
       OR NEW.course_version_id IS DISTINCT FROM assessment_course_version THEN
      RAISE EXCEPTION 'course assessment attempt must match pinned enrollment version'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_assessment_attempt_binding
BEFORE INSERT OR UPDATE ON platform.learning_assessment_attempts
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_attempt_binding();

ALTER TABLE platform.learning_question_banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_question_banks FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_question_banks_tenant_isolation ON platform.learning_question_banks
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_questions FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_questions_tenant_isolation ON platform.learning_questions
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_question_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_question_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_question_versions_tenant_isolation ON platform.learning_question_versions
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_assessments FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_assessments_tenant_isolation ON platform.learning_assessments
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_assessment_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_assessment_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_assessment_versions_tenant_isolation ON platform.learning_assessment_versions
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_assessment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_assessment_items FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_assessment_items_tenant_isolation ON platform.learning_assessment_items
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_assessment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_assessment_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_assessment_attempts_tenant_isolation ON platform.learning_assessment_attempts
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_assessment_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_assessment_responses FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_assessment_responses_tenant_isolation ON platform.learning_assessment_responses
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
