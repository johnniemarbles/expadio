\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('51515151-5151-4151-8151-515151515151', 'Assessment Smoke A'),
  ('62626262-6262-4262-8262-626262626262', 'Assessment Smoke B');

INSERT INTO platform.tenant_modules (
  tenant_id, module_key, status, activation_requested_by_subject_id,
  activated_by_subject_id, activated_at
) VALUES
  ('51515151-5151-4151-8151-515151515151', 'learning', 'ACTIVE', 'admin-a', 'admin-a', now()),
  ('62626262-6262-4262-8262-626262626262', 'learning', 'ACTIVE', 'admin-b', 'admin-b', now());

INSERT INTO platform.learning_tenant_settings (
  tenant_id, tenant_module_id, academy_name
)
SELECT tenant_id, tenant_module_id,
       CASE WHEN tenant_id = '51515151-5151-4151-8151-515151515151'::uuid
            THEN 'Assessment Academy A' ELSE 'Assessment Academy B' END
  FROM platform.tenant_modules
 WHERE tenant_id IN (
   '51515151-5151-4151-8151-515151515151'::uuid,
   '62626262-6262-4262-8262-626262626262'::uuid
 );

INSERT INTO platform.learning_academies (
  tenant_id, tenant_module_id, name, slug, is_default
)
SELECT tenant_id, tenant_module_id,
       CASE WHEN tenant_id = '51515151-5151-4151-8151-515151515151'::uuid
            THEN 'Assessment Academy A' ELSE 'Assessment Academy B' END,
       'assessment-academy', true
  FROM platform.tenant_modules
 WHERE tenant_id IN (
   '51515151-5151-4151-8151-515151515151'::uuid,
   '62626262-6262-4262-8262-626262626262'::uuid
 );

INSERT INTO platform.learning_courses (
  tenant_id, academy_id, course_key, created_by_subject_id
)
SELECT tenant_id, academy_id, 'assessment.smoke.course', 'smoke-admin'
  FROM platform.learning_academies
 WHERE tenant_id IN (
   '51515151-5151-4151-8151-515151515151'::uuid,
   '62626262-6262-4262-8262-626262626262'::uuid
 );

INSERT INTO platform.learning_course_versions (
  tenant_id, course_id, version, state, title, language, learning_objectives,
  created_by_subject_id, updated_by_subject_id
)
SELECT tenant_id, course_id, 1, 'DRAFT', 'Assessment Smoke Course', 'en',
       '["Pass assessment"]'::jsonb, 'smoke-admin', 'smoke-admin'
  FROM platform.learning_courses
 WHERE tenant_id IN (
   '51515151-5151-4151-8151-515151515151'::uuid,
   '62626262-6262-4262-8262-626262626262'::uuid
 );

INSERT INTO platform.learning_course_modules (
  tenant_id, course_version_id, module_key, title, position
)
SELECT tenant_id, course_version_id, 'module', 'Module', 1
  FROM platform.learning_course_versions
 WHERE tenant_id IN (
   '51515151-5151-4151-8151-515151515151'::uuid,
   '62626262-6262-4262-8262-626262626262'::uuid
 )
   AND version = 1;

INSERT INTO platform.learning_lessons (
  tenant_id, course_version_id, course_module_id, lesson_key, title,
  activity_type, position, required, content
)
SELECT tenant_id, course_version_id, course_module_id, 'lesson', 'Lesson',
       'TEXT', 1, true, '{}'::jsonb
  FROM platform.learning_course_modules
 WHERE tenant_id IN (
   '51515151-5151-4151-8151-515151515151'::uuid,
   '62626262-6262-4262-8262-626262626262'::uuid
 );

UPDATE platform.learning_course_versions
   SET state = 'PUBLISHED',
       published_by_subject_id = 'smoke-admin',
       published_at = now(),
       updated_by_subject_id = 'smoke-admin',
       updated_at = now()
 WHERE tenant_id IN (
   '51515151-5151-4151-8151-515151515151'::uuid,
   '62626262-6262-4262-8262-626262626262'::uuid
 )
   AND version = 1;

UPDATE platform.learning_courses
   SET current_published_version = 1,
       updated_at = now()
 WHERE tenant_id IN (
   '51515151-5151-4151-8151-515151515151'::uuid,
   '62626262-6262-4262-8262-626262626262'::uuid
 );

INSERT INTO platform.learning_learners (
  tenant_id, external_ref, full_name, audience_type, created_by_subject_id
) VALUES
  ('51515151-5151-4151-8151-515151515151', 'assessment-smoke-a', 'Learner A', 'EXTERNAL', 'smoke-admin'),
  ('62626262-6262-4262-8262-626262626262', 'assessment-smoke-b', 'Learner B', 'EXTERNAL', 'smoke-admin');

INSERT INTO platform.learning_enrollments (
  tenant_id, learner_id, course_id, course_version_id, assignment_key,
  source_type, assigned_by_subject_id
)
SELECT learner.tenant_id, learner.learner_id, course.course_id, version.course_version_id,
       'assessment:' || learner.external_ref, 'MANUAL', 'smoke-admin'
  FROM platform.learning_learners learner
  JOIN platform.learning_courses course
    ON course.tenant_id = learner.tenant_id
  JOIN platform.learning_course_versions version
    ON version.tenant_id = course.tenant_id
   AND version.course_id = course.course_id
   AND version.version = 1
 WHERE learner.tenant_id IN (
   '51515151-5151-4151-8151-515151515151'::uuid,
   '62626262-6262-4262-8262-626262626262'::uuid
 );

INSERT INTO platform.learning_question_banks (
  tenant_id, academy_id, bank_key, name, created_by_subject_id
)
SELECT tenant_id, academy_id, 'assessment.smoke.bank', 'Assessment Smoke Bank', 'smoke-admin'
  FROM platform.learning_academies
 WHERE tenant_id IN (
   '51515151-5151-4151-8151-515151515151'::uuid,
   '62626262-6262-4262-8262-626262626262'::uuid
 );

INSERT INTO platform.learning_questions (
  tenant_id, question_bank_id, question_key, created_by_subject_id
)
SELECT tenant_id, question_bank_id, 'question.one', 'smoke-admin'
  FROM platform.learning_question_banks
 WHERE tenant_id IN (
   '51515151-5151-4151-8151-515151515151'::uuid,
   '62626262-6262-4262-8262-626262626262'::uuid
 );

INSERT INTO platform.learning_question_versions (
  tenant_id, question_id, version, state, question_type, prompt,
  options, answer_key, explanation, created_by_subject_id, updated_by_subject_id
)
SELECT tenant_id, question_id, 1, 'DRAFT', 'SINGLE_CHOICE', 'Choose A',
       '[{"key":"a","label":"A"},{"key":"b","label":"B"}]'::jsonb,
       '{"answer":"a"}'::jsonb, 'A is correct.', 'smoke-admin', 'smoke-admin'
  FROM platform.learning_questions
 WHERE tenant_id IN (
   '51515151-5151-4151-8151-515151515151'::uuid,
   '62626262-6262-4262-8262-626262626262'::uuid
 );

UPDATE platform.learning_question_versions
   SET state = 'PUBLISHED',
       published_by_subject_id = 'smoke-admin',
       published_at = now(),
       updated_by_subject_id = 'smoke-admin',
       updated_at = now()
 WHERE tenant_id IN (
   '51515151-5151-4151-8151-515151515151'::uuid,
   '62626262-6262-4262-8262-626262626262'::uuid
 );

UPDATE platform.learning_questions
   SET current_published_version = 1,
       updated_at = now()
 WHERE tenant_id IN (
   '51515151-5151-4151-8151-515151515151'::uuid,
   '62626262-6262-4262-8262-626262626262'::uuid
 );

INSERT INTO platform.learning_assessments (
  tenant_id, academy_id, assessment_key, created_by_subject_id
)
SELECT tenant_id, academy_id, 'assessment.smoke.exam', 'smoke-admin'
  FROM platform.learning_academies
 WHERE tenant_id IN (
   '51515151-5151-4151-8151-515151515151'::uuid,
   '62626262-6262-4262-8262-626262626262'::uuid
 );

INSERT INTO platform.learning_assessment_versions (
  tenant_id, assessment_id, version, state, title, assessment_type,
  pass_percent, max_attempts, course_version_id,
  created_by_subject_id, updated_by_subject_id
)
SELECT assessment.tenant_id, assessment.assessment_id, 1, 'DRAFT',
       'Assessment Smoke Exam', 'EXAM', 100, 2, course_version.course_version_id,
       'smoke-admin', 'smoke-admin'
  FROM platform.learning_assessments assessment
  JOIN platform.learning_courses course
    ON course.tenant_id = assessment.tenant_id
  JOIN platform.learning_course_versions course_version
    ON course_version.tenant_id = course.tenant_id
   AND course_version.course_id = course.course_id
   AND course_version.version = 1
 WHERE assessment.tenant_id IN (
   '51515151-5151-4151-8151-515151515151'::uuid,
   '62626262-6262-4262-8262-626262626262'::uuid
 );

INSERT INTO platform.learning_assessment_items (
  tenant_id, assessment_version_id, question_version_id, position, points
)
SELECT assessment_version.tenant_id, assessment_version.assessment_version_id,
       question_version.question_version_id, 1, 1
  FROM platform.learning_assessment_versions assessment_version
  JOIN platform.learning_question_versions question_version
    ON question_version.tenant_id = assessment_version.tenant_id
   AND question_version.version = 1
 WHERE assessment_version.tenant_id IN (
   '51515151-5151-4151-8151-515151515151'::uuid,
   '62626262-6262-4262-8262-626262626262'::uuid
 );

UPDATE platform.learning_assessment_versions
   SET state = 'PUBLISHED',
       published_by_subject_id = 'smoke-admin',
       published_at = now(),
       updated_by_subject_id = 'smoke-admin',
       updated_at = now()
 WHERE tenant_id IN (
   '51515151-5151-4151-8151-515151515151'::uuid,
   '62626262-6262-4262-8262-626262626262'::uuid
 );

UPDATE platform.learning_assessments
   SET current_published_version = 1,
       updated_at = now()
 WHERE tenant_id IN (
   '51515151-5151-4151-8151-515151515151'::uuid,
   '62626262-6262-4262-8262-626262626262'::uuid
 );

INSERT INTO platform.learning_assessment_attempts (
  tenant_id, assessment_id, assessment_version_id, learner_id,
  enrollment_id, course_version_id, attempt_key, attempt_number
)
SELECT assessment.tenant_id, assessment.assessment_id,
       assessment_version.assessment_version_id, learner.learner_id,
       enrollment.enrollment_id, enrollment.course_version_id,
       'smoke-attempt:' || learner.external_ref, 1
  FROM platform.learning_assessments assessment
  JOIN platform.learning_assessment_versions assessment_version
    ON assessment_version.tenant_id = assessment.tenant_id
   AND assessment_version.assessment_id = assessment.assessment_id
   AND assessment_version.version = 1
  JOIN platform.learning_learners learner
    ON learner.tenant_id = assessment.tenant_id
  JOIN platform.learning_enrollments enrollment
    ON enrollment.tenant_id = learner.tenant_id
   AND enrollment.learner_id = learner.learner_id
   AND enrollment.course_version_id = assessment_version.course_version_id
 WHERE assessment.tenant_id IN (
   '51515151-5151-4151-8151-515151515151'::uuid,
   '62626262-6262-4262-8262-626262626262'::uuid
 );

DO $$
DECLARE
  qv uuid;
  av uuid;
BEGIN
  SELECT question_version_id INTO qv
    FROM platform.learning_question_versions
   WHERE tenant_id = '51515151-5151-4151-8151-515151515151'::uuid
     AND version = 1;

  BEGIN
    UPDATE platform.learning_question_versions
       SET prompt = 'Changed after publish'
     WHERE question_version_id = qv;
    RAISE EXCEPTION 'published question mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'published question mutation unexpectedly succeeded' THEN RAISE; END IF;
    IF POSITION('only draft learning question versions may edit content' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  SELECT assessment_version_id INTO av
    FROM platform.learning_assessment_versions
   WHERE tenant_id = '51515151-5151-4151-8151-515151515151'::uuid
     AND version = 1;

  BEGIN
    DELETE FROM platform.learning_assessment_items
     WHERE assessment_version_id = av;
    RAISE EXCEPTION 'published assessment item delete unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'published assessment item delete unexpectedly succeeded' THEN RAISE; END IF;
    IF POSITION('may mutate only while version is DRAFT' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_learning_assessment_smoke;
CREATE ROLE expadio_learning_assessment_smoke NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_learning_assessment_smoke;
GRANT SELECT ON
  platform.learning_question_banks,
  platform.learning_questions,
  platform.learning_question_versions,
  platform.learning_assessments,
  platform.learning_assessment_versions,
  platform.learning_assessment_items,
  platform.learning_assessment_attempts
TO expadio_learning_assessment_smoke;

SET ROLE expadio_learning_assessment_smoke;
SELECT set_config('app.tenant_id', '51515151-5151-4151-8151-515151515151', false);

DO $$
DECLARE
  question_count integer;
  assessment_count integer;
  attempt_count integer;
BEGIN
  SELECT count(*) INTO question_count FROM platform.learning_questions;
  SELECT count(*) INTO assessment_count FROM platform.learning_assessments;
  SELECT count(*) INTO attempt_count FROM platform.learning_assessment_attempts;

  IF question_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one question, got %', question_count;
  END IF;
  IF assessment_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one assessment, got %', assessment_count;
  END IF;
  IF attempt_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one attempt, got %', attempt_count;
  END IF;
END;
$$;

RESET ROLE;

SELECT 'learning assessment smoke: ok' AS result;
