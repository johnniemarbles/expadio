\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('71717171-7171-4171-8171-717171717171', 'Program Cert Smoke A'),
  ('82828282-8282-4282-8282-828282828282', 'Program Cert Smoke B');

INSERT INTO platform.tenant_modules (
  tenant_id, module_key, status, activation_requested_by_subject_id,
  activated_by_subject_id, activated_at
) VALUES
  ('71717171-7171-4171-8171-717171717171', 'learning', 'ACTIVE', 'admin-a', 'admin-a', now()),
  ('82828282-8282-4282-8282-828282828282', 'learning', 'ACTIVE', 'admin-b', 'admin-b', now());

INSERT INTO platform.learning_academies (
  tenant_id, tenant_module_id, name, slug, is_default
)
SELECT tenant_id, tenant_module_id,
       CASE WHEN tenant_id = '71717171-7171-4171-8171-717171717171'::uuid
            THEN 'Program Academy A' ELSE 'Program Academy B' END,
       'program-academy', true
  FROM platform.tenant_modules
 WHERE tenant_id IN (
   '71717171-7171-4171-8171-717171717171'::uuid,
   '82828282-8282-4282-8282-828282828282'::uuid
 );

INSERT INTO platform.learning_courses (
  tenant_id, academy_id, course_key, created_by_subject_id
)
SELECT tenant_id, academy_id, 'program.cert.smoke.course', 'smoke-admin'
  FROM platform.learning_academies
 WHERE tenant_id IN (
   '71717171-7171-4171-8171-717171717171'::uuid,
   '82828282-8282-4282-8282-828282828282'::uuid
 );

INSERT INTO platform.learning_course_versions (
  tenant_id, course_id, version, state, title, language, learning_objectives,
  created_by_subject_id, updated_by_subject_id
)
SELECT tenant_id, course_id, 1, 'DRAFT', 'Program Credential Course', 'en',
       '["Complete program requirement"]'::jsonb,
       'smoke-admin', 'smoke-admin'
  FROM platform.learning_courses
 WHERE tenant_id IN (
   '71717171-7171-4171-8171-717171717171'::uuid,
   '82828282-8282-4282-8282-828282828282'::uuid
 );

INSERT INTO platform.learning_course_modules (
  tenant_id, course_version_id, module_key, title, position
)
SELECT tenant_id, course_version_id, 'module', 'Module', 1
  FROM platform.learning_course_versions
 WHERE tenant_id IN (
   '71717171-7171-4171-8171-717171717171'::uuid,
   '82828282-8282-4282-8282-828282828282'::uuid
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
   '71717171-7171-4171-8171-717171717171'::uuid,
   '82828282-8282-4282-8282-828282828282'::uuid
 );

UPDATE platform.learning_course_versions
   SET state = 'PUBLISHED',
       published_by_subject_id = 'smoke-admin',
       published_at = now(),
       updated_by_subject_id = 'smoke-admin',
       updated_at = now()
 WHERE tenant_id IN (
   '71717171-7171-4171-8171-717171717171'::uuid,
   '82828282-8282-4282-8282-828282828282'::uuid
 );

UPDATE platform.learning_courses
   SET current_published_version = 1,
       updated_at = now()
 WHERE tenant_id IN (
   '71717171-7171-4171-8171-717171717171'::uuid,
   '82828282-8282-4282-8282-828282828282'::uuid
 );

INSERT INTO platform.learning_learners (
  tenant_id, external_ref, full_name, audience_type, created_by_subject_id
) VALUES
  ('71717171-7171-4171-8171-717171717171', 'program-cert-a', 'Learner A', 'EXTERNAL', 'smoke-admin'),
  ('82828282-8282-4282-8282-828282828282', 'program-cert-b', 'Learner B', 'EXTERNAL', 'smoke-admin');

INSERT INTO platform.learning_programs (
  tenant_id, academy_id, program_key, created_by_subject_id
)
SELECT tenant_id, academy_id, 'program.cert.smoke', 'smoke-admin'
  FROM platform.learning_academies
 WHERE tenant_id IN (
   '71717171-7171-4171-8171-717171717171'::uuid,
   '82828282-8282-4282-8282-828282828282'::uuid
 );

INSERT INTO platform.learning_program_versions (
  tenant_id, program_id, version, state, title, description,
  created_by_subject_id, updated_by_subject_id
)
SELECT tenant_id, program_id, 1, 'DRAFT', 'Program Certification Smoke',
       'Pinned published course requirement.', 'smoke-admin', 'smoke-admin'
  FROM platform.learning_programs
 WHERE tenant_id IN (
   '71717171-7171-4171-8171-717171717171'::uuid,
   '82828282-8282-4282-8282-828282828282'::uuid
 );

INSERT INTO platform.learning_program_items (
  tenant_id, program_version_id, item_type, course_version_id,
  position, required
)
SELECT program_version.tenant_id, program_version.program_version_id,
       'COURSE', course_version.course_version_id, 1, true
  FROM platform.learning_program_versions program_version
  JOIN platform.learning_programs program
    ON program.program_id = program_version.program_id
   AND program.tenant_id = program_version.tenant_id
  JOIN platform.learning_courses course
    ON course.tenant_id = program.tenant_id
  JOIN platform.learning_course_versions course_version
    ON course_version.tenant_id = course.tenant_id
   AND course_version.course_id = course.course_id
   AND course_version.version = 1
 WHERE program_version.tenant_id IN (
   '71717171-7171-4171-8171-717171717171'::uuid,
   '82828282-8282-4282-8282-828282828282'::uuid
 );

UPDATE platform.learning_program_versions
   SET state = 'PUBLISHED',
       published_by_subject_id = 'smoke-admin',
       published_at = now(),
       updated_by_subject_id = 'smoke-admin',
       updated_at = now()
 WHERE tenant_id IN (
   '71717171-7171-4171-8171-717171717171'::uuid,
   '82828282-8282-4282-8282-828282828282'::uuid
 );

UPDATE platform.learning_programs
   SET current_published_version = 1,
       updated_at = now()
 WHERE tenant_id IN (
   '71717171-7171-4171-8171-717171717171'::uuid,
   '82828282-8282-4282-8282-828282828282'::uuid
 );

INSERT INTO platform.learning_program_enrollments (
  tenant_id, learner_id, program_id, program_version_id,
  assignment_key, source_type, assigned_by_subject_id
)
SELECT learner.tenant_id, learner.learner_id, program.program_id,
       program_version.program_version_id,
       'smoke-program:' || learner.external_ref, 'MANUAL', 'smoke-admin'
  FROM platform.learning_learners learner
  JOIN platform.learning_programs program
    ON program.tenant_id = learner.tenant_id
  JOIN platform.learning_program_versions program_version
    ON program_version.tenant_id = program.tenant_id
   AND program_version.program_id = program.program_id
   AND program_version.version = 1
 WHERE learner.tenant_id IN (
   '71717171-7171-4171-8171-717171717171'::uuid,
   '82828282-8282-4282-8282-828282828282'::uuid
 );

UPDATE platform.learning_program_enrollments
   SET status = 'COMPLETED',
       started_at = now(),
       completed_at = now(),
       completion_percent = 100,
       last_reconciled_at = now(),
       updated_at = now()
 WHERE tenant_id IN (
   '71717171-7171-4171-8171-717171717171'::uuid,
   '82828282-8282-4282-8282-828282828282'::uuid
 );

INSERT INTO platform.learning_certifications (
  tenant_id, academy_id, certification_key, created_by_subject_id
)
SELECT tenant_id, academy_id, 'program.cert.credential', 'smoke-admin'
  FROM platform.learning_academies
 WHERE tenant_id IN (
   '71717171-7171-4171-8171-717171717171'::uuid,
   '82828282-8282-4282-8282-828282828282'::uuid
 );

INSERT INTO platform.learning_certification_versions (
  tenant_id, certification_id, version, state, title, description,
  program_version_id, validity_days, renewal_window_days,
  created_by_subject_id, updated_by_subject_id
)
SELECT certification.tenant_id, certification.certification_id, 1, 'DRAFT',
       'Program Certified', 'Finite credential.',
       program_version.program_version_id, 365, 30,
       'smoke-admin', 'smoke-admin'
  FROM platform.learning_certifications certification
  JOIN platform.learning_programs program
    ON program.tenant_id = certification.tenant_id
  JOIN platform.learning_program_versions program_version
    ON program_version.tenant_id = program.tenant_id
   AND program_version.program_id = program.program_id
   AND program_version.version = 1
 WHERE certification.tenant_id IN (
   '71717171-7171-4171-8171-717171717171'::uuid,
   '82828282-8282-4282-8282-828282828282'::uuid
 );

UPDATE platform.learning_certification_versions
   SET state = 'PUBLISHED',
       published_by_subject_id = 'smoke-admin',
       published_at = now(),
       updated_by_subject_id = 'smoke-admin',
       updated_at = now()
 WHERE tenant_id IN (
   '71717171-7171-4171-8171-717171717171'::uuid,
   '82828282-8282-4282-8282-828282828282'::uuid
 );

UPDATE platform.learning_certifications
   SET current_published_version = 1,
       updated_at = now()
 WHERE tenant_id IN (
   '71717171-7171-4171-8171-717171717171'::uuid,
   '82828282-8282-4282-8282-828282828282'::uuid
 );

INSERT INTO platform.learning_credentials (
  tenant_id, credential_key, certification_id, certification_version_id,
  program_enrollment_id, learner_id, program_version_id, status,
  issued_by_subject_id, issued_at, renewal_due_at, expires_at
)
SELECT enrollment.tenant_id,
       'credential-' || enrollment.learner_id::text,
       certification.certification_id,
       certification_version.certification_version_id,
       enrollment.program_enrollment_id,
       enrollment.learner_id,
       enrollment.program_version_id,
       'ACTIVE',
       'smoke-admin',
       now(),
       now() + interval '335 days',
       now() + interval '365 days'
  FROM platform.learning_program_enrollments enrollment
  JOIN platform.learning_certification_versions certification_version
    ON certification_version.tenant_id = enrollment.tenant_id
   AND certification_version.program_version_id = enrollment.program_version_id
   AND certification_version.version = 1
  JOIN platform.learning_certifications certification
    ON certification.certification_id = certification_version.certification_id
   AND certification.tenant_id = certification_version.tenant_id
 WHERE enrollment.tenant_id IN (
   '71717171-7171-4171-8171-717171717171'::uuid,
   '82828282-8282-4282-8282-828282828282'::uuid
 );

DO $$
DECLARE
  program_version uuid;
  certification_version uuid;
BEGIN
  SELECT program_version_id INTO program_version
    FROM platform.learning_program_versions
   WHERE tenant_id = '71717171-7171-4171-8171-717171717171'::uuid
     AND version = 1;

  BEGIN
    UPDATE platform.learning_program_versions
       SET title = 'Tampered Program'
     WHERE program_version_id = program_version;
    RAISE EXCEPTION 'published program mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'published program mutation unexpectedly succeeded' THEN RAISE; END IF;
    IF POSITION('only draft learning program versions may edit content' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM platform.learning_program_items
     WHERE program_version_id = program_version;
    RAISE EXCEPTION 'published program item delete unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'published program item delete unexpectedly succeeded' THEN RAISE; END IF;
    IF POSITION('may mutate only while version is DRAFT' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  SELECT certification_version_id INTO certification_version
    FROM platform.learning_certification_versions
   WHERE tenant_id = '71717171-7171-4171-8171-717171717171'::uuid
     AND version = 1;

  BEGIN
    UPDATE platform.learning_certification_versions
       SET validity_days = 730
     WHERE certification_version_id = certification_version;
    RAISE EXCEPTION 'published certification mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'published certification mutation unexpectedly succeeded' THEN RAISE; END IF;
    IF POSITION('only draft learning certification versions may edit content' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_learning_program_cert_smoke;
CREATE ROLE expadio_learning_program_cert_smoke NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_learning_program_cert_smoke;
GRANT SELECT ON
  platform.learning_programs,
  platform.learning_program_versions,
  platform.learning_program_items,
  platform.learning_program_enrollments,
  platform.learning_certifications,
  platform.learning_certification_versions,
  platform.learning_credentials
TO expadio_learning_program_cert_smoke;

SET ROLE expadio_learning_program_cert_smoke;
SELECT set_config('app.tenant_id', '71717171-7171-4171-8171-717171717171', false);

DO $$
DECLARE
  program_count integer;
  enrollment_count integer;
  certification_count integer;
  credential_count integer;
BEGIN
  SELECT count(*) INTO program_count FROM platform.learning_programs;
  SELECT count(*) INTO enrollment_count FROM platform.learning_program_enrollments;
  SELECT count(*) INTO certification_count FROM platform.learning_certifications;
  SELECT count(*) INTO credential_count FROM platform.learning_credentials;

  IF program_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one program, got %', program_count;
  END IF;
  IF enrollment_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one program enrollment, got %', enrollment_count;
  END IF;
  IF certification_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one certification, got %', certification_count;
  END IF;
  IF credential_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one credential, got %', credential_count;
  END IF;
END;
$$;

RESET ROLE;

SELECT 'learning program certification smoke: ok' AS result;
