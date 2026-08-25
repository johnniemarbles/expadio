\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Auth Tenant C'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Auth Tenant D');

INSERT INTO platform.organizations (organization_id, tenant_id, name) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Auth Org C'),
  ('d2222222-2222-2222-2222-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Auth Org D');

INSERT INTO platform.authorization_roles (
  role_id, role_key, display_name, ownership_scope, tenant_id
) VALUES
  ('c3000000-0000-0000-0000-000000000001', 'PLATFORM_AUDITOR', 'Platform Auditor', 'PLATFORM', NULL),
  ('c3000000-0000-0000-0000-000000000002', 'TENANT_C_OPERATOR', 'Tenant C Operator', 'TENANT', 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('d3000000-0000-0000-0000-000000000003', 'TENANT_D_OPERATOR', 'Tenant D Operator', 'TENANT', 'dddddddd-dddd-dddd-dddd-dddddddddddd');

INSERT INTO platform.authorization_role_capabilities (
  role_id, action, resource_type, blocked_states
) VALUES
  ('c3000000-0000-0000-0000-000000000001', 'read', 'audit_event', ARRAY[]::text[]),
  ('c3000000-0000-0000-0000-000000000002', 'update', 'case', ARRAY['CLOSED']::text[]),
  ('d3000000-0000-0000-0000-000000000003', 'update', 'case', ARRAY[]::text[]);

INSERT INTO platform.authorization_assignments (
  assignment_id, tenant_id, organization_id, subject_id, role_id,
  action_organization_ids, clearances
) VALUES
  (
    'c4000000-0000-0000-0000-000000000001',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    NULL,
    'user-auth',
    'c3000000-0000-0000-0000-000000000001',
    NULL,
    ARRAY['restricted']::text[]
  ),
  (
    'c4000000-0000-0000-0000-000000000002',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'c1111111-1111-1111-1111-111111111111',
    'user-auth',
    'c3000000-0000-0000-0000-000000000002',
    ARRAY['c1111111-1111-1111-1111-111111111111']::uuid[],
    ARRAY['confidential']::text[]
  ),
  (
    'd4000000-0000-0000-0000-000000000003',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'd2222222-2222-2222-2222-222222222222',
    'user-auth',
    'd3000000-0000-0000-0000-000000000003',
    NULL,
    ARRAY[]::text[]
  );

INSERT INTO platform.authorization_restrictions (
  tenant_id, subject_id, restriction_key, action, resource_type, resource_id, reason
) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user-auth', 'C-LEGAL-HOLD', 'update', 'case', 'case-7', 'Legal hold.'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user-auth', 'D-LEGAL-HOLD', 'update', 'case', 'case-8', 'Other tenant hold.');

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.authorization_assignments (
      tenant_id, organization_id, subject_id, role_id
    ) VALUES (
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'c1111111-1111-1111-1111-111111111111',
      'cross-tenant-attempt',
      'd3000000-0000-0000-0000-000000000003'
    );
    RAISE EXCEPTION 'cross-tenant authorization role assignment unexpectedly succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'cross-tenant authorization role assignment unexpectedly succeeded' THEN
        RAISE;
      END IF;
      IF POSITION('cannot cross tenants' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_auth_test;
CREATE ROLE expadio_auth_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_auth_test;
GRANT SELECT ON
  platform.authorization_roles,
  platform.authorization_role_capabilities,
  platform.authorization_assignments,
  platform.authorization_restrictions
TO expadio_auth_test;

SET ROLE expadio_auth_test;
SELECT set_config('app.tenant_id', 'cccccccc-cccc-cccc-cccc-cccccccccccc', false);

DO $$
DECLARE
  role_count integer;
  capability_count integer;
  assignment_count integer;
  restriction_count integer;
BEGIN
  SELECT count(*) INTO role_count FROM platform.authorization_roles;
  IF role_count <> 2 THEN
    RAISE EXCEPTION 'tenant C expected platform + own role only, got %', role_count;
  END IF;

  SELECT count(*) INTO capability_count FROM platform.authorization_role_capabilities;
  IF capability_count <> 2 THEN
    RAISE EXCEPTION 'tenant C expected 2 visible role capabilities, got %', capability_count;
  END IF;

  SELECT count(*) INTO assignment_count
  FROM platform.authorization_assignments
  WHERE subject_id = 'user-auth';
  IF assignment_count <> 2 THEN
    RAISE EXCEPTION 'tenant C expected 2 own assignments, got %', assignment_count;
  END IF;

  SELECT count(*) INTO restriction_count
  FROM platform.authorization_restrictions
  WHERE subject_id = 'user-auth';
  IF restriction_count <> 1 THEN
    RAISE EXCEPTION 'tenant C expected 1 own restriction, got %', restriction_count;
  END IF;
END;
$$;

RESET ROLE;

SELECT 'authorization policy smoke: ok' AS result;
