\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('12121212-1212-4121-8121-121212121212', 'Enrollment Tenant A'),
  ('34343434-3434-4343-8343-343434343434', 'Enrollment Tenant B');

INSERT INTO platform.tenant_modules (
  tenant_id, module_key, status, activation_requested_by_subject_id,
  activated_by_subject_id, activated_at
) VALUES
  ('12121212-1212-4121-8121-121212121212', 'learning', 'ACTIVE', 'admin-a', 'admin-a', now()),
  ('34343434-3434-4343-8343-343434343434', 'learning', 'ACTIVE', 'admin-b', 'admin-b', now());

INSERT INTO platform.learning_tenant_settings (
  tenant_id, tenant_module_id, academy_name
)
SELECT tenant_id, tenant_module_id,
       CASE WHEN tenant_id = '12121212-1212-4121-8121-121212121212'::uuid
            THEN 'Enrollment Academy A' ELSE 'Enrollment Academy B' END
  FROM platform.tenant_modules
 WHERE tenant_id IN (
   '12121212-1212-4121-8121-121212121212'::uuid,
   '34343434-3434-4343-8343-343434343434'::uuid
 );

INSERT INTO platform.learning_academies (
  tenant_id, tenant_module_id, name, slug, is_default
)
SELECT tenant_id, tenant_module_id,
       CASE WHEN tenant_id = '12121212-1212-4121-8121-121212121212'::uuid
            THEN 'Enrollment Academy A' ELSE 'Enrollment Academy B' END,
       'academy', true
  FROM platform.tenant_modules
 WHERE tenant_id IN (
   '12121212-1212-4121-8121-121212121212'::uuid,
   '34343434-3434-4343-8343-343434343434'::uuid
 );

INSERT INTO platform.learning_courses (
  tenant_id, academy_id, course_key, created_by_subject_id
)
SELECT tenant_id, academy_id, 'enrollment.smoke', 'smoke-admin'
  FROM platform.learning_academies
 WHERE tenant_id IN (
   '12121212-1212-4121-8121-121212121212'::uuid,
   '34343434-3434-4343-8343-343434343434'::uuid
 );

INSERT INTO platform.learning_course_versions (
  tenant_id, course_id, version, state, title, language, learning_objectives,
  created_by_subject_id, updated_by_subject_id, published_by_subject_id, published_at
)
SELECT tenant_id, course_id, 1, 'DRAFT', 'Enrollment Smoke v1', 'en',
       '["Complete required learning"]'::jsonb,
       'smoke-admin', 'smoke-admin', NULL, NULL
  FROM platform.learning_courses
 WHERE tenant_id IN (
   '12121212-1212-4121-8121-121212121212'::uuid,
   '34343434-3434-4343-8343-343434343434'::uuid
 );

INSERT INTO platform.learning_course_modules (
  tenant_id, course_version_id, module_key, title, position
)
SELECT tenant_id, course_version_id, 'required', 'Required', 1
  FROM platform.learning_course_versions
 WHERE version = 1
   AND tenant_id IN (
     '12121212-1212-4121-8121-121212121212'::uuid,
     '34343434-3434-4343-8343-343434343434'::uuid
   );

INSERT INTO platform.learning_lessons (
  tenant_id, course_version_id, course_module_id, lesson_key, title,
  activity_type, position, required, content
)
SELECT tenant_id, course_version_id, course_module_id, 'lesson', 'Required lesson',
       'TEXT', 1, true, '{}'::jsonb
  FROM platform.learning_course_modules
 WHERE tenant_id IN (
   '12121212-1212-4121-8121-121212121212'::uuid,
   '34343434-3434-4343-8343-343434343434'::uuid
 );

UPDATE platform.learning_course_versions
   SET state = 'PUBLISHED',
       published_by_subject_id = 'smoke-admin',
       published_at = now(),
       updated_by_subject_id = 'smoke-admin',
       updated_at = now()
 WHERE tenant_id IN (
   '12121212-1212-4121-8121-121212121212'::uuid,
   '34343434-3434-4343-8343-343434343434'::uuid
 )
   AND version = 1;

UPDATE platform.learning_courses
   SET current_published_version = 1,
       updated_at = now()
 WHERE tenant_id IN (
   '12121212-1212-4121-8121-121212121212'::uuid,
   '34343434-3434-4343-8343-343434343434'::uuid
 );

INSERT INTO platform.learning_learners (
  tenant_id, external_ref, full_name, audience_type, created_by_subject_id
) VALUES
  ('12121212-1212-4121-8121-121212121212', 'smoke-a', 'Learner A', 'EXTERNAL', 'smoke-admin'),
  ('34343434-3434-4343-8343-343434343434', 'smoke-b', 'Learner B', 'EXTERNAL', 'smoke-admin');

INSERT INTO platform.learning_enrollments (
  tenant_id, learner_id, course_id, course_version_id, assignment_key,
  source_type, assigned_by_subject_id
)
SELECT l.tenant_id, l.learner_id, c.course_id, v.course_version_id,
       'smoke:' || l.external_ref, 'MANUAL', 'smoke-admin'
  FROM platform.learning_learners l
  JOIN platform.learning_courses c ON c.tenant_id = l.tenant_id
  JOIN platform.learning_course_versions v
    ON v.course_id = c.course_id AND v.tenant_id = c.tenant_id AND v.version = 1;

INSERT INTO platform.learning_lesson_progress (
  tenant_id, enrollment_id, course_version_id, lesson_id,
  status, progress_percent, completed_at, updated_by_subject_id
)
SELECT e.tenant_id, e.enrollment_id, e.course_version_id, lesson.lesson_id,
       'COMPLETED', 100, now(), 'smoke-learner'
  FROM platform.learning_enrollments e
  JOIN platform.learning_lessons lesson
    ON lesson.tenant_id = e.tenant_id
   AND lesson.course_version_id = e.course_version_id;

DO $$
DECLARE
  tenant_a_course uuid;
  tenant_a_v1 uuid;
  tenant_a_v2 uuid;
  tenant_a_learner uuid;
  tenant_a_enrollment uuid;
BEGIN
  SELECT course_id INTO tenant_a_course
    FROM platform.learning_courses
   WHERE tenant_id = '12121212-1212-4121-8121-121212121212'::uuid;

  SELECT course_version_id INTO tenant_a_v1
    FROM platform.learning_course_versions
   WHERE tenant_id = '12121212-1212-4121-8121-121212121212'::uuid
     AND version = 1;

  SELECT learner_id INTO tenant_a_learner
    FROM platform.learning_learners
   WHERE tenant_id = '12121212-1212-4121-8121-121212121212'::uuid;

  SELECT enrollment_id INTO tenant_a_enrollment
    FROM platform.learning_enrollments
   WHERE tenant_id = '12121212-1212-4121-8121-121212121212'::uuid;

  INSERT INTO platform.learning_course_versions (
    tenant_id, course_id, version, state, title, language, learning_objectives,
    created_by_subject_id, updated_by_subject_id
  ) VALUES (
    '12121212-1212-4121-8121-121212121212'::uuid,
    tenant_a_course, 2, 'DRAFT', 'Enrollment Smoke v2', 'en',
    '["Future version"]'::jsonb, 'smoke-admin', 'smoke-admin'
  ) RETURNING course_version_id INTO tenant_a_v2;

  BEGIN
    INSERT INTO platform.learning_enrollments (
      tenant_id, learner_id, course_id, course_version_id, assignment_key,
      source_type, assigned_by_subject_id
    ) VALUES (
      '12121212-1212-4121-8121-121212121212'::uuid,
      tenant_a_learner, tenant_a_course, tenant_a_v2,
      'smoke:draft-version', 'MANUAL', 'smoke-admin'
    );
    RAISE EXCEPTION 'draft enrollment unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'draft enrollment unexpectedly succeeded' THEN RAISE; END IF;
    IF POSITION('must pin a published course version' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE platform.learning_enrollments
       SET course_version_id = tenant_a_v2
     WHERE enrollment_id = tenant_a_enrollment;
    RAISE EXCEPTION 'pinned enrollment mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'pinned enrollment mutation unexpectedly succeeded' THEN RAISE; END IF;
    IF POSITION('identity and pinned version are immutable' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  IF NOT EXISTS (
    SELECT 1
      FROM platform.learning_enrollments
     WHERE enrollment_id = tenant_a_enrollment
       AND course_version_id = tenant_a_v1
  ) THEN
    RAISE EXCEPTION 'enrollment did not retain pinned v1';
  END IF;
END;
$$;

DROP ROLE IF EXISTS expadio_learning_enrollment_smoke;
CREATE ROLE expadio_learning_enrollment_smoke NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_learning_enrollment_smoke;
GRANT SELECT ON
  platform.learning_learners,
  platform.learning_enrollments,
  platform.learning_lesson_progress
TO expadio_learning_enrollment_smoke;

SET ROLE expadio_learning_enrollment_smoke;
SELECT set_config('app.tenant_id', '12121212-1212-4121-8121-121212121212', false);

DO $$
DECLARE
  learner_count integer;
  enrollment_count integer;
  progress_count integer;
BEGIN
  SELECT count(*) INTO learner_count FROM platform.learning_learners;
  SELECT count(*) INTO enrollment_count FROM platform.learning_enrollments;
  SELECT count(*) INTO progress_count FROM platform.learning_lesson_progress;

  IF learner_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one learner, got %', learner_count;
  END IF;
  IF enrollment_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one enrollment, got %', enrollment_count;
  END IF;
  IF progress_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one progress row, got %', progress_count;
  END IF;
END;
$$;

RESET ROLE;

SELECT 'learning enrollment progress smoke: ok' AS result;
