BEGIN;

-- LMS-09 — explicit course completion policy for course-linked assessments.
-- Existing assessments remain OPTIONAL so this migration does not retroactively
-- change tenant completion semantics. REQUIRED is an explicit authoring choice.

ALTER TABLE platform.learning_assessment_versions
  ADD COLUMN completion_requirement text NOT NULL DEFAULT 'OPTIONAL'
    CHECK (completion_requirement IN ('OPTIONAL','REQUIRED'));

ALTER TABLE platform.learning_assessment_versions
  ADD CONSTRAINT learning_required_assessment_requires_course
  CHECK (completion_requirement <> 'REQUIRED' OR course_version_id IS NOT NULL);

CREATE INDEX learning_assessment_completion_requirement_idx
  ON platform.learning_assessment_versions
  (tenant_id, course_version_id, completion_requirement, state)
  WHERE course_version_id IS NOT NULL;

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
       OR OLD.completion_requirement IS DISTINCT FROM NEW.completion_requirement
     ) THEN
    RAISE EXCEPTION 'only draft learning assessment versions may edit content'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state = 'PUBLISHED'
     AND (NEW.published_by_subject_id IS NULL OR NEW.published_at IS NULL) THEN
    RAISE EXCEPTION 'published learning assessment versions require publication provenance'
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

COMMIT;
