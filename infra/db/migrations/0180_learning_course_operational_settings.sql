BEGIN;

-- LMS course wizard operational controls must survive draft, publish, and clone.
ALTER TABLE platform.learning_course_versions
  ADD COLUMN IF NOT EXISTS enrollment_mode text NOT NULL DEFAULT 'ASSIGNED_ONLY'
    CHECK (enrollment_mode IN ('OPEN','ASSIGNED_ONLY','APPROVAL_REQUIRED')),
  ADD COLUMN IF NOT EXISTS certificate_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS passing_score integer
    CHECK (passing_score IS NULL OR (passing_score >= 0 AND passing_score <= 100));

DROP TRIGGER IF EXISTS learning_course_versions_lifecycle ON platform.learning_course_versions;

CREATE OR REPLACE FUNCTION platform.enforce_learning_course_version_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'DRAFT' THEN
      RAISE EXCEPTION 'non-draft learning course versions are immutable'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.course_id IS DISTINCT FROM NEW.course_id
     OR OLD.version IS DISTINCT FROM NEW.version
     OR OLD.created_by_subject_id IS DISTINCT FROM NEW.created_by_subject_id
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'learning course version identity/provenance is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state <> 'DRAFT' AND (
       OLD.title IS DISTINCT FROM NEW.title
       OR OLD.summary IS DISTINCT FROM NEW.summary
       OR OLD.description IS DISTINCT FROM NEW.description
       OR OLD.language IS DISTINCT FROM NEW.language
       OR OLD.visibility IS DISTINCT FROM NEW.visibility
       OR OLD.enrollment_mode IS DISTINCT FROM NEW.enrollment_mode
       OR OLD.certificate_enabled IS DISTINCT FROM NEW.certificate_enabled
       OR OLD.passing_score IS DISTINCT FROM NEW.passing_score
       OR OLD.estimated_minutes IS DISTINCT FROM NEW.estimated_minutes
       OR OLD.learning_objectives IS DISTINCT FROM NEW.learning_objectives
     ) THEN
    RAISE EXCEPTION 'only draft learning course versions may edit content'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state = 'DRAFT' AND NEW.state NOT IN ('DRAFT','IN_REVIEW','PUBLISHED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning course version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'IN_REVIEW' AND NEW.state NOT IN ('IN_REVIEW','DRAFT','PUBLISHED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning course version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'PUBLISHED' AND NEW.state NOT IN ('PUBLISHED','SUPERSEDED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning course version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'SUPERSEDED' AND NEW.state NOT IN ('SUPERSEDED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning course version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'ARCHIVED' AND NEW.state <> 'ARCHIVED' THEN
    RAISE EXCEPTION 'archived learning course versions are terminal'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state = 'PUBLISHED'
     AND (NEW.published_by_subject_id IS NULL OR NEW.published_at IS NULL) THEN
    RAISE EXCEPTION 'published learning course versions require publication provenance'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state = 'PUBLISHED' AND OLD.state <> 'PUBLISHED' THEN
    IF jsonb_array_length(NEW.learning_objectives) = 0 THEN
      RAISE EXCEPTION 'published learning course versions require learning objectives'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM platform.learning_course_modules m
       WHERE m.course_version_id = NEW.course_version_id
         AND m.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'published learning course versions require at least one module'
        USING ERRCODE = 'check_violation';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM platform.learning_course_modules m
       WHERE m.course_version_id = NEW.course_version_id
         AND m.tenant_id = NEW.tenant_id
         AND NOT EXISTS (
           SELECT 1
             FROM platform.learning_lessons l
            WHERE l.course_module_id = m.course_module_id
              AND l.tenant_id = NEW.tenant_id
         )
    ) THEN
      RAISE EXCEPTION 'published learning course modules require at least one lesson'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_course_versions_lifecycle
BEFORE UPDATE OR DELETE ON platform.learning_course_versions
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_course_version_lifecycle();

COMMENT ON COLUMN platform.learning_course_versions.enrollment_mode IS
  'Course-level enrollment policy selected by the tenant authoring surface.';
COMMENT ON COLUMN platform.learning_course_versions.certificate_enabled IS
  'Whether this course version should issue a completion certificate.';
COMMENT ON COLUMN platform.learning_course_versions.passing_score IS
  'Optional course-level passing threshold, from 0 to 100.';

COMMIT;
