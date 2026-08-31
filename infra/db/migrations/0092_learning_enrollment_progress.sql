BEGIN;

-- LMS-02 — learner identity, version-pinned enrollment, progress, completion.
--
-- Learners do not duplicate IAM. A learner may bind to an authenticated
-- subject, a tenant CRM contact, or an external reference. Internal self-service
-- uses subject_id. Every enrollment pins one immutable published course version.

ALTER TABLE platform.crm_contacts
  ADD CONSTRAINT crm_contacts_contact_tenant_uq
  UNIQUE (contact_id, tenant_id);

ALTER TABLE platform.learning_course_versions
  ADD CONSTRAINT learning_course_versions_course_identity_uq
  UNIQUE (course_version_id, tenant_id, course_id);

ALTER TABLE platform.learning_lessons
  ADD CONSTRAINT learning_lessons_version_identity_uq
  UNIQUE (lesson_id, tenant_id, course_version_id);

CREATE TABLE platform.learning_learners (
  learner_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  subject_id text,
  subject_issuer text,
  contact_id uuid,
  external_ref text,
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 200),
  email text,
  audience_type text NOT NULL DEFAULT 'INTERNAL'
    CHECK (audience_type IN ('INTERNAL','PARTNER','CUSTOMER','EXTERNAL')),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','SUSPENDED','ARCHIVED')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (learner_id, tenant_id),
  FOREIGN KEY (contact_id, tenant_id)
    REFERENCES platform.crm_contacts(contact_id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT learning_learner_identity_required CHECK (
    subject_id IS NOT NULL OR contact_id IS NOT NULL OR external_ref IS NOT NULL
  ),
  CONSTRAINT learning_learner_subject_nonblank CHECK (
    subject_id IS NULL OR btrim(subject_id) <> ''
  ),
  CONSTRAINT learning_learner_subject_issuer_consistency CHECK (
    subject_id IS NOT NULL OR subject_issuer IS NULL
  ),
  CONSTRAINT learning_learner_subject_issuer_nonblank CHECK (
    subject_issuer IS NULL OR btrim(subject_issuer) <> ''
  ),
  CONSTRAINT learning_learner_external_ref_nonblank CHECK (
    external_ref IS NULL OR btrim(external_ref) <> ''
  )
);

CREATE UNIQUE INDEX learning_learners_subject_uq
  ON platform.learning_learners (
    tenant_id,
    subject_id,
    COALESCE(subject_issuer, '')
  )
  WHERE subject_id IS NOT NULL;

CREATE UNIQUE INDEX learning_learners_contact_uq
  ON platform.learning_learners (tenant_id, contact_id)
  WHERE contact_id IS NOT NULL;

CREATE UNIQUE INDEX learning_learners_external_ref_uq
  ON platform.learning_learners (tenant_id, external_ref)
  WHERE external_ref IS NOT NULL;

CREATE INDEX learning_learners_status_idx
  ON platform.learning_learners (tenant_id, status, full_name);

CREATE TABLE platform.learning_enrollments (
  enrollment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  learner_id uuid NOT NULL,
  course_id uuid NOT NULL,
  course_version_id uuid NOT NULL,
  assignment_key text NOT NULL CHECK (
    assignment_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  source_type text NOT NULL DEFAULT 'MANUAL'
    CHECK (source_type IN ('MANUAL','RULE','PROGRAM','SELF','IMPORT')),
  source_ref text,
  status text NOT NULL DEFAULT 'ASSIGNED'
    CHECK (status IN ('ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED','EXPIRED')),
  assigned_by_subject_id text NOT NULL CHECK (btrim(assigned_by_subject_id) <> ''),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  completion_percent numeric(5,2) NOT NULL DEFAULT 0
    CHECK (completion_percent >= 0 AND completion_percent <= 100),
  last_activity_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, tenant_id),
  UNIQUE (enrollment_id, tenant_id, course_version_id),
  UNIQUE (tenant_id, assignment_key),
  FOREIGN KEY (learner_id, tenant_id)
    REFERENCES platform.learning_learners(learner_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (course_id, tenant_id)
    REFERENCES platform.learning_courses(course_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (course_version_id, tenant_id, course_id)
    REFERENCES platform.learning_course_versions(course_version_id, tenant_id, course_id)
    ON DELETE RESTRICT,
  CONSTRAINT learning_enrollment_due_after_assignment CHECK (
    due_at IS NULL OR due_at > assigned_at
  ),
  CONSTRAINT learning_enrollment_completion_state CHECK (
    (status = 'COMPLETED' AND completed_at IS NOT NULL AND completion_percent = 100)
    OR
    (status <> 'COMPLETED')
  )
);

CREATE INDEX learning_enrollments_learner_idx
  ON platform.learning_enrollments (tenant_id, learner_id, status, assigned_at DESC);

CREATE INDEX learning_enrollments_course_idx
  ON platform.learning_enrollments (tenant_id, course_id, status, assigned_at DESC);

CREATE INDEX learning_enrollments_due_idx
  ON platform.learning_enrollments (tenant_id, due_at)
  WHERE status IN ('ASSIGNED','IN_PROGRESS') AND due_at IS NOT NULL;

CREATE TABLE platform.learning_lesson_progress (
  lesson_progress_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL,
  course_version_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (status IN ('IN_PROGRESS','COMPLETED')),
  progress_percent numeric(5,2) NOT NULL DEFAULT 0
    CHECK (progress_percent >= 0 AND progress_percent <= 100),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_by_subject_id text NOT NULL CHECK (btrim(updated_by_subject_id) <> ''),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lesson_progress_id, tenant_id),
  UNIQUE (enrollment_id, lesson_id),
  FOREIGN KEY (enrollment_id, tenant_id, course_version_id)
    REFERENCES platform.learning_enrollments(enrollment_id, tenant_id, course_version_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (lesson_id, tenant_id, course_version_id)
    REFERENCES platform.learning_lessons(lesson_id, tenant_id, course_version_id)
    ON DELETE RESTRICT,
  CONSTRAINT learning_lesson_progress_completion CHECK (
    (status = 'COMPLETED' AND completed_at IS NOT NULL AND progress_percent = 100)
    OR
    (status = 'IN_PROGRESS' AND completed_at IS NULL)
  )
);

CREATE INDEX learning_lesson_progress_enrollment_idx
  ON platform.learning_lesson_progress (tenant_id, enrollment_id, status);

CREATE OR REPLACE FUNCTION platform.enforce_learning_enrollment_published_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_state text;
BEGIN
  SELECT state INTO version_state
    FROM platform.learning_course_versions
   WHERE course_version_id = NEW.course_version_id
     AND tenant_id = NEW.tenant_id
     AND course_id = NEW.course_id;

  IF version_state IS DISTINCT FROM 'PUBLISHED'
     AND NOT EXISTS (
       SELECT 1
         FROM platform.learning_enrollments existing
        WHERE existing.enrollment_id = NEW.enrollment_id
          AND existing.tenant_id = NEW.tenant_id
          AND existing.course_version_id = NEW.course_version_id
     ) THEN
    RAISE EXCEPTION 'new learning enrollments must pin a published course version'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' AND (
       OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR OLD.learner_id IS DISTINCT FROM NEW.learner_id
       OR OLD.course_id IS DISTINCT FROM NEW.course_id
       OR OLD.course_version_id IS DISTINCT FROM NEW.course_version_id
       OR OLD.assignment_key IS DISTINCT FROM NEW.assignment_key
     ) THEN
    RAISE EXCEPTION 'learning enrollment identity and pinned version are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_enrollment_published_version
BEFORE INSERT OR UPDATE ON platform.learning_enrollments
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_enrollment_published_version();

CREATE OR REPLACE FUNCTION platform.enforce_learning_progress_active_enrollment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  enrollment_state text;
BEGIN
  SELECT status INTO enrollment_state
    FROM platform.learning_enrollments
   WHERE enrollment_id = NEW.enrollment_id
     AND tenant_id = NEW.tenant_id
     AND course_version_id = NEW.course_version_id;

  IF enrollment_state NOT IN ('ASSIGNED','IN_PROGRESS') THEN
    RAISE EXCEPTION 'learning progress requires an active enrollment'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' AND (
       OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR OLD.enrollment_id IS DISTINCT FROM NEW.enrollment_id
       OR OLD.course_version_id IS DISTINCT FROM NEW.course_version_id
       OR OLD.lesson_id IS DISTINCT FROM NEW.lesson_id
     ) THEN
    RAISE EXCEPTION 'learning progress identity is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_progress_active_enrollment
BEFORE INSERT OR UPDATE ON platform.learning_lesson_progress
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_progress_active_enrollment();

ALTER TABLE platform.learning_learners ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_learners FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_learners_tenant_isolation
  ON platform.learning_learners
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_enrollments FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_enrollments_tenant_isolation
  ON platform.learning_enrollments
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_lesson_progress FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_lesson_progress_tenant_isolation
  ON platform.learning_lesson_progress
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
