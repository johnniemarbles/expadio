\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Learning Tenant A'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Learning Tenant B');

INSERT INTO platform.tenant_modules (
  tenant_id, module_key, status, activation_requested_by_subject_id,
  activated_by_subject_id, activated_at
) VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'learning', 'ACTIVE', 'admin-a', 'admin-a', now()),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'learning', 'ACTIVE', 'admin-b', 'admin-b', now());

INSERT INTO platform.learning_tenant_settings (
  tenant_id, tenant_module_id, academy_name
)
SELECT tenant_id, tenant_module_id,
       CASE WHEN tenant_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid
            THEN 'Academy A' ELSE 'Academy B' END
  FROM platform.tenant_modules
 WHERE tenant_id IN (
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid,
   'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid
 );

INSERT INTO platform.learning_academies (
  tenant_id, tenant_module_id, name, slug, is_default
)
SELECT tenant_id, tenant_module_id,
       CASE WHEN tenant_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid
            THEN 'Academy A' ELSE 'Academy B' END,
       'academy', true
  FROM platform.tenant_modules
 WHERE tenant_id IN (
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid,
   'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid
 );

INSERT INTO platform.learning_courses (
  tenant_id, academy_id, course_key, created_by_subject_id
)
SELECT a.tenant_id, a.academy_id, 'smoke.course', 'smoke-admin'
  FROM platform.learning_academies a
 WHERE a.tenant_id IN (
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid,
   'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid
 );

INSERT INTO platform.learning_course_versions (
  tenant_id, course_id, version, state, title, language, learning_objectives,
  created_by_subject_id, updated_by_subject_id, published_by_subject_id, published_at
)
SELECT tenant_id, course_id, 1, 'PUBLISHED', 'Published Smoke Course', 'en',
       '["Understand the smoke contract"]'::jsonb,
       'smoke-admin', 'smoke-admin', 'smoke-admin', now()
  FROM platform.learning_courses;

DO $$
DECLARE
  v_id uuid;
BEGIN
  SELECT course_version_id INTO v_id
    FROM platform.learning_course_versions
   WHERE tenant_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid;

  BEGIN
    UPDATE platform.learning_course_versions
       SET title = 'Mutated published title'
     WHERE course_version_id = v_id;
    RAISE EXCEPTION 'published version mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'published version mutation unexpectedly succeeded' THEN RAISE; END IF;
    IF POSITION('only draft learning course versions may edit content' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO platform.learning_course_modules (
      tenant_id, course_version_id, module_key, title, position
    ) VALUES (
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid,
      v_id,
      'illegal-module',
      'Illegal module',
      1
    );
    RAISE EXCEPTION 'published child insert unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'published child insert unexpectedly succeeded' THEN RAISE; END IF;
    IF POSITION('may mutate only while course version is DRAFT' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_learning_authoring_smoke;
CREATE ROLE expadio_learning_authoring_smoke NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_learning_authoring_smoke;
GRANT SELECT ON
  platform.learning_courses,
  platform.learning_course_versions,
  platform.learning_course_modules,
  platform.learning_lessons
TO expadio_learning_authoring_smoke;

SET ROLE expadio_learning_authoring_smoke;
SELECT set_config('app.tenant_id', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', false);

DO $$
DECLARE
  course_count integer;
  version_count integer;
BEGIN
  SELECT count(*) INTO course_count FROM platform.learning_courses;
  IF course_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one visible course, got %', course_count;
  END IF;

  SELECT count(*) INTO version_count FROM platform.learning_course_versions;
  IF version_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one visible course version, got %', version_count;
  END IF;
END;
$$;

RESET ROLE;

SELECT 'learning course authoring smoke: ok' AS result;
