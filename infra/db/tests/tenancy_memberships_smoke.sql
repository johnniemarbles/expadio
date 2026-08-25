\set ON_ERROR_STOP on

INSERT INTO platform.organizations (organization_id, tenant_id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Org A'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Org B');

INSERT INTO platform.workspaces (workspace_id, tenant_id, organization_id, name) VALUES
  ('31111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Workspace A'),
  ('32222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Workspace B');

INSERT INTO platform.operating_units (operating_unit_id, tenant_id, organization_id, name) VALUES
  ('41111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Unit A'),
  ('42222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Unit B');

INSERT INTO platform.memberships (
  membership_id, tenant_id, organization_id, subject_id, actor_kind, issuer,
  workspace_scope_mode, operating_unit_scope_mode
) VALUES
  ('51111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'user-123', 'user', 'oidc:test', 'SELECTED', 'SELECTED'),
  ('52222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'user-456', 'user', 'oidc:test', 'SELECTED', 'SELECTED');

INSERT INTO platform.membership_workspaces (membership_id, tenant_id, workspace_id) VALUES
  ('51111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '31111111-1111-1111-1111-111111111111'),
  ('52222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '32222222-2222-2222-2222-222222222222');

INSERT INTO platform.membership_operating_units (membership_id, tenant_id, operating_unit_id) VALUES
  ('51111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '41111111-1111-1111-1111-111111111111'),
  ('52222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '42222222-2222-2222-2222-222222222222');

GRANT SELECT ON platform.tenants, platform.organizations, platform.workspaces,
  platform.operating_units, platform.memberships, platform.membership_workspaces,
  platform.membership_operating_units TO expadio_app;

SET ROLE expadio_app;
SELECT set_config('app.tenant_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SELECT set_config('app.subject_id', 'user-123', false);
SELECT set_config('app.organization_id', '11111111-1111-1111-1111-111111111111', false);

DO $$
DECLARE
  tenant_count integer;
  org_count integer;
  membership_count integer;
  workspace_count integer;
  unit_count integer;
BEGIN
  SELECT count(*) INTO tenant_count FROM platform.tenants;
  IF tenant_count <> 1 THEN RAISE EXCEPTION 'expected 1 visible tenant, got %', tenant_count; END IF;

  SELECT count(*) INTO org_count FROM platform.organizations;
  IF org_count <> 1 THEN RAISE EXCEPTION 'expected 1 visible organization, got %', org_count; END IF;

  SELECT count(*) INTO membership_count FROM platform.memberships;
  IF membership_count <> 1 THEN RAISE EXCEPTION 'expected 1 visible membership, got %', membership_count; END IF;

  SELECT count(*) INTO workspace_count FROM platform.membership_workspaces;
  IF workspace_count <> 1 THEN RAISE EXCEPTION 'expected 1 visible membership workspace, got %', workspace_count; END IF;

  SELECT count(*) INTO unit_count FROM platform.membership_operating_units;
  IF unit_count <> 1 THEN RAISE EXCEPTION 'expected 1 visible membership operating unit, got %', unit_count; END IF;

  IF platform.current_subject_id() <> 'user-123' THEN RAISE EXCEPTION 'subject session context mismatch'; END IF;
  IF platform.current_organization_id() <> '11111111-1111-1111-1111-111111111111'::uuid THEN
    RAISE EXCEPTION 'organization session context mismatch';
  END IF;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'platform'
      AND c.relname = 'memberships'
      AND c.relrowsecurity = true
      AND c.relforcerowsecurity = true
  ) THEN
    RAISE EXCEPTION 'memberships RLS is not forced';
  END IF;
END;
$$;

SELECT 'tenancy memberships smoke: ok' AS result;
