BEGIN;

-- Enterprise Control Plane foundation.
-- Tenant remains the security/commercial boundary. Enterprise/legal/organization
-- model business governance beneath it.

CREATE TABLE platform.enterprise_profiles (
  enterprise_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  mode text NOT NULL DEFAULT 'SIMPLE' CHECK (mode IN ('SIMPLE','GLOBAL')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','INACTIVE')),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  updated_by_subject_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enterprise_id, tenant_id)
);

CREATE UNIQUE INDEX enterprise_profiles_active_name_uq
  ON platform.enterprise_profiles (tenant_id, lower(name))
  WHERE status = 'ACTIVE';

CREATE TABLE platform.legal_entities (
  legal_entity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  enterprise_id uuid NOT NULL,
  parent_legal_entity_id uuid,
  legal_name text NOT NULL CHECK (btrim(legal_name) <> ''),
  entity_type text NOT NULL CHECK (entity_type IN (
    'CORPORATION','LLC','PARTNERSHIP','SOLE_PROPRIETORSHIP','TRUST',
    'NONPROFIT','JOINT_VENTURE','GOVERNMENT','OTHER'
  )),
  jurisdiction_country_code text NOT NULL CHECK (jurisdiction_country_code ~ '^[A-Z]{2}$'),
  jurisdiction_subdivision_code text,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','VERIFICATION_PENDING','VERIFIED','REJECTED','INACTIVE')),
  verification_source text,
  verified_at timestamptz,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  updated_by_subject_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, tenant_id),
  UNIQUE (legal_entity_id, tenant_id, enterprise_id),
  FOREIGN KEY (enterprise_id, tenant_id)
    REFERENCES platform.enterprise_profiles(enterprise_id, tenant_id)
    ON DELETE CASCADE,
  FOREIGN KEY (parent_legal_entity_id, tenant_id, enterprise_id)
    REFERENCES platform.legal_entities(legal_entity_id, tenant_id, enterprise_id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (parent_legal_entity_id IS NULL OR parent_legal_entity_id <> legal_entity_id),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK (
    (status = 'VERIFIED' AND verified_at IS NOT NULL)
    OR status <> 'VERIFIED'
  )
);

CREATE INDEX legal_entities_tenant_enterprise_idx
  ON platform.legal_entities (tenant_id, enterprise_id, status, legal_name);

CREATE TABLE platform.legal_entity_registration_identifiers (
  registration_identifier_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL,
  jurisdiction_code text NOT NULL CHECK (btrim(jurisdiction_code) <> ''),
  identifier_type text NOT NULL CHECK (btrim(identifier_type) <> ''),
  identifier_value text NOT NULL CHECK (btrim(identifier_value) <> ''),
  normalized_identifier text NOT NULL CHECK (btrim(normalized_identifier) <> ''),
  verification_status text NOT NULL DEFAULT 'PENDING'
    CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED','REVOKED')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (legal_entity_id, tenant_id)
    REFERENCES platform.legal_entities(legal_entity_id, tenant_id)
    ON DELETE CASCADE,
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE UNIQUE INDEX legal_entity_registration_identity_uq
  ON platform.legal_entity_registration_identifiers (
    tenant_id,
    upper(jurisdiction_code),
    upper(identifier_type),
    normalized_identifier
  )
  WHERE verification_status <> 'REVOKED' AND valid_until IS NULL;

CREATE INDEX legal_entity_registration_lookup_idx
  ON platform.legal_entity_registration_identifiers (
    tenant_id, normalized_identifier, verification_status
  );

CREATE TABLE platform.legal_entity_addresses (
  legal_entity_address_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL,
  address_type text NOT NULL CHECK (address_type IN ('REGISTERED','MAILING','OPERATING','TAX')),
  line1 text NOT NULL CHECK (btrim(line1) <> ''),
  line2 text,
  locality text,
  administrative_area text,
  postal_code text,
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (legal_entity_id, tenant_id)
    REFERENCES platform.legal_entities(legal_entity_id, tenant_id)
    ON DELETE CASCADE,
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE platform.legal_entity_classifications (
  legal_entity_classification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL,
  classification_key text NOT NULL CHECK (classification_key IN (
    'HOLDCO','IP_OWNER','BRAND_OWNER','OPCO','COUNTRY_OPCO',
    'MASTER_FRANCHISEE','FRANCHISEE','LICENSEE','DISTRIBUTOR','JV_COMPANY','OTHER'
  )),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (legal_entity_id, tenant_id)
    REFERENCES platform.legal_entities(legal_entity_id, tenant_id)
    ON DELETE CASCADE,
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE UNIQUE INDEX legal_entity_classifications_active_uq
  ON platform.legal_entity_classifications (tenant_id, legal_entity_id, classification_key)
  WHERE valid_until IS NULL;

CREATE TABLE platform.legal_entity_business_functions (
  legal_entity_business_function_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL,
  function_key text NOT NULL CHECK (function_key IN (
    'EMPLOYER','CONTRACTING_ENTITY','BILLING_ENTITY','TAX_ENTITY',
    'LICENSOR','MANAGEMENT_PROVIDER','SHARED_SERVICES_PROVIDER'
  )),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (legal_entity_id, tenant_id)
    REFERENCES platform.legal_entities(legal_entity_id, tenant_id)
    ON DELETE CASCADE,
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE UNIQUE INDEX legal_entity_business_functions_active_uq
  ON platform.legal_entity_business_functions (tenant_id, legal_entity_id, function_key)
  WHERE valid_until IS NULL;

CREATE TABLE platform.ownership_interests (
  ownership_interest_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  owned_legal_entity_id uuid NOT NULL,
  owner_legal_entity_id uuid,
  owner_party_subject_id text,
  ownership_percent numeric(7,4) NOT NULL CHECK (ownership_percent > 0 AND ownership_percent <= 100),
  voting_percent numeric(7,4) CHECK (voting_percent >= 0 AND voting_percent <= 100),
  control_type text NOT NULL DEFAULT 'EQUITY'
    CHECK (control_type IN ('EQUITY','VOTING','CONTRACTUAL','BENEFICIAL','OTHER')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owned_legal_entity_id, tenant_id)
    REFERENCES platform.legal_entities(legal_entity_id, tenant_id)
    ON DELETE CASCADE,
  FOREIGN KEY (owner_legal_entity_id, tenant_id)
    REFERENCES platform.legal_entities(legal_entity_id, tenant_id)
    ON DELETE RESTRICT,
  CHECK ((owner_legal_entity_id IS NOT NULL) <> (owner_party_subject_id IS NOT NULL)),
  CHECK (owner_legal_entity_id IS NULL OR owner_legal_entity_id <> owned_legal_entity_id),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE platform.beneficial_owners (
  beneficial_owner_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL,
  party_subject_id text NOT NULL CHECK (btrim(party_subject_id) <> ''),
  ownership_percent numeric(7,4) CHECK (ownership_percent >= 0 AND ownership_percent <= 100),
  control_basis text,
  verification_status text NOT NULL DEFAULT 'PENDING'
    CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED','REVOKED')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (legal_entity_id, tenant_id)
    REFERENCES platform.legal_entities(legal_entity_id, tenant_id)
    ON DELETE CASCADE,
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE platform.organization_legal_entity_bindings (
  organization_legal_entity_binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  binding_role text NOT NULL CHECK (binding_role IN (
    'OPERATED_BY','EMPLOYER','CONTRACTING_ENTITY','BILLING_ENTITY',
    'TAX_ENTITY','LICENSOR','MANAGEMENT_PROVIDER','SHARED_SERVICES_PROVIDER'
  )),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE,
  FOREIGN KEY (legal_entity_id, tenant_id)
    REFERENCES platform.legal_entities(legal_entity_id, tenant_id)
    ON DELETE RESTRICT,
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE UNIQUE INDEX organization_legal_entity_binding_active_uq
  ON platform.organization_legal_entity_bindings (
    tenant_id, organization_id, legal_entity_id, binding_role
  )
  WHERE status = 'ACTIVE' AND valid_until IS NULL;

-- Operational hierarchy traversal read model.
CREATE TABLE platform.organization_closure (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  ancestor_organization_id uuid NOT NULL,
  descendant_organization_id uuid NOT NULL,
  depth integer NOT NULL CHECK (depth >= 0),
  PRIMARY KEY (tenant_id, ancestor_organization_id, descendant_organization_id),
  FOREIGN KEY (ancestor_organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE,
  FOREIGN KEY (descendant_organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE,
  CHECK (
    (depth = 0 AND ancestor_organization_id = descendant_organization_id)
    OR
    (depth > 0 AND ancestor_organization_id <> descendant_organization_id)
  )
);

CREATE INDEX organization_closure_descendant_idx
  ON platform.organization_closure (tenant_id, descendant_organization_id, depth);

CREATE OR REPLACE FUNCTION platform.organization_parent_would_cycle(
  p_tenant_id uuid,
  p_organization_id uuid,
  p_parent_organization_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE ancestors AS (
    SELECT
      o.organization_id,
      o.parent_organization_id,
      ARRAY[o.organization_id]::uuid[] AS path
    FROM platform.organizations o
    WHERE o.tenant_id = p_tenant_id
      AND o.organization_id = p_parent_organization_id

    UNION ALL

    SELECT
      parent.organization_id,
      parent.parent_organization_id,
      ancestors.path || parent.organization_id
    FROM ancestors
    JOIN platform.organizations parent
      ON parent.tenant_id = p_tenant_id
     AND parent.organization_id = ancestors.parent_organization_id
    WHERE NOT parent.organization_id = ANY(ancestors.path)
  )
  SELECT
    p_parent_organization_id = p_organization_id
    OR EXISTS (
      SELECT 1
      FROM ancestors
      WHERE organization_id = p_organization_id
    );
$$;

CREATE OR REPLACE FUNCTION platform.reject_organization_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.parent_organization_id IS NOT NULL
     AND platform.organization_parent_would_cycle(
       NEW.tenant_id,
       NEW.organization_id,
       NEW.parent_organization_id
     ) THEN
    RAISE EXCEPTION 'organization hierarchy cycle rejected'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  row_record record;
BEGIN
  FOR row_record IN
    SELECT tenant_id, organization_id, parent_organization_id
      FROM platform.organizations
     WHERE parent_organization_id IS NOT NULL
  LOOP
    IF platform.organization_parent_would_cycle(
      row_record.tenant_id,
      row_record.organization_id,
      row_record.parent_organization_id
    ) THEN
      RAISE EXCEPTION 'existing organization hierarchy contains a cycle for organization %',
        row_record.organization_id;
    END IF;
  END LOOP;
END;
$$;

CREATE TRIGGER organizations_reject_cycles
BEFORE INSERT OR UPDATE OF parent_organization_id, tenant_id
ON platform.organizations
FOR EACH ROW EXECUTE FUNCTION platform.reject_organization_cycle();

CREATE OR REPLACE FUNCTION platform.refresh_organization_closure(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM platform.organization_closure
   WHERE tenant_id = p_tenant_id;

  INSERT INTO platform.organization_closure (
    tenant_id, ancestor_organization_id, descendant_organization_id, depth
  )
  SELECT
    o.tenant_id, o.organization_id, o.organization_id, 0
  FROM platform.organizations o
  WHERE o.tenant_id = p_tenant_id;

  WITH RECURSIVE paths AS (
    SELECT
      child.tenant_id,
      child.parent_organization_id AS ancestor_organization_id,
      child.organization_id AS descendant_organization_id,
      1 AS depth,
      ARRAY[child.parent_organization_id, child.organization_id]::uuid[] AS path
    FROM platform.organizations child
    WHERE child.tenant_id = p_tenant_id
      AND child.parent_organization_id IS NOT NULL

    UNION ALL

    SELECT
      paths.tenant_id,
      paths.ancestor_organization_id,
      child.organization_id,
      paths.depth + 1,
      paths.path || child.organization_id
    FROM paths
    JOIN platform.organizations child
      ON child.tenant_id = paths.tenant_id
     AND child.parent_organization_id = paths.descendant_organization_id
    WHERE NOT child.organization_id = ANY(paths.path)
  )
  INSERT INTO platform.organization_closure (
    tenant_id, ancestor_organization_id, descendant_organization_id, depth
  )
  SELECT tenant_id, ancestor_organization_id, descendant_organization_id, min(depth)
  FROM paths
  GROUP BY tenant_id, ancestor_organization_id, descendant_organization_id
  ON CONFLICT (tenant_id, ancestor_organization_id, descendant_organization_id)
  DO UPDATE SET depth = EXCLUDED.depth;
END;
$$;

CREATE OR REPLACE FUNCTION platform.refresh_organization_closure_after_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM platform.refresh_organization_closure(COALESCE(NEW.tenant_id, OLD.tenant_id));
  IF TG_OP = 'UPDATE' AND OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    PERFORM platform.refresh_organization_closure(OLD.tenant_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER organizations_refresh_closure
AFTER INSERT OR UPDATE OF parent_organization_id, tenant_id OR DELETE
ON platform.organizations
FOR EACH ROW EXECUTE FUNCTION platform.refresh_organization_closure_after_change();

DO $$
DECLARE
  tenant_record record;
BEGIN
  FOR tenant_record IN SELECT tenant_id FROM platform.tenants
  LOOP
    PERFORM platform.refresh_organization_closure(tenant_record.tenant_id);
  END LOOP;
END;
$$;

-- Preserve exact-membership behavior while enabling enterprise descendant scope.
ALTER TABLE platform.memberships
  ADD COLUMN organization_scope_mode text NOT NULL DEFAULT 'SELF'
  CHECK (organization_scope_mode IN ('SELF','DESCENDANTS','SELF_AND_DESCENDANTS','SELECTED'));

CREATE TABLE platform.membership_organizations (
  membership_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  PRIMARY KEY (membership_id, organization_id),
  FOREIGN KEY (membership_id, tenant_id)
    REFERENCES platform.memberships(membership_id, tenant_id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE
);

-- Approval is a business object lifecycle, deliberately separate from activation.
CREATE TABLE platform.enterprise_change_requests (
  enterprise_change_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  enterprise_id uuid,
  operation text NOT NULL CHECK (operation IN (
    'CREATE_ORGANIZATION','REPARENT_ORGANIZATION','CREATE_LEGAL_ENTITY',
    'CHANGE_OWNERSHIP','CHANGE_OPERATING_ENTITY','APPOINT_PARTNER',
    'EXPAND_TERRITORY','ACTIVATE_JURISDICTION','SUSPEND_ORGANIZATION'
  )),
  requesting_organization_id uuid NOT NULL,
  approving_organization_id uuid NOT NULL,
  target_organization_id uuid,
  target_legal_entity_id uuid,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','SUBMITTED','UNDER_REVIEW','CHANGES_REQUESTED',
    'APPROVED','REJECTED','CANCELLED'
  )),
  proposed_payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(proposed_payload) = 'object'),
  requested_by_subject_id text NOT NULL CHECK (btrim(requested_by_subject_id) <> ''),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by_subject_id text,
  decided_at timestamptz,
  decision_reason text,
  workflow_instance_id uuid,
  correlation_id text NOT NULL CHECK (btrim(correlation_id) <> ''),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (enterprise_id, tenant_id)
    REFERENCES platform.enterprise_profiles(enterprise_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (requesting_organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (approving_organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (target_organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (target_legal_entity_id, tenant_id)
    REFERENCES platform.legal_entities(legal_entity_id, tenant_id)
    ON DELETE RESTRICT
);

CREATE INDEX enterprise_change_requests_review_idx
  ON platform.enterprise_change_requests (
    tenant_id, approving_organization_id, status, requested_at
  );

-- Organization lifecycle: approval/provisioning and activation remain separate.
ALTER TABLE platform.organizations
  DROP CONSTRAINT IF EXISTS organizations_status_check;

ALTER TABLE platform.organizations
  ADD CONSTRAINT organizations_status_check
  CHECK (status IN (
    'PROVISIONING','CONFIGURING','READY_FOR_ACTIVATION',
    'ACTIVE','SUSPENDED','INACTIVE','CLOSED'
  ));

-- Every tenant-scoped enterprise table is FORCE-RLS protected.
ALTER TABLE platform.enterprise_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.enterprise_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.legal_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.legal_entities FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.legal_entity_registration_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.legal_entity_registration_identifiers FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.legal_entity_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.legal_entity_addresses FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.legal_entity_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.legal_entity_classifications FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.legal_entity_business_functions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.legal_entity_business_functions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.ownership_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ownership_interests FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.beneficial_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.beneficial_owners FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_legal_entity_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_legal_entity_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_closure ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_closure FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.membership_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.membership_organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.enterprise_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.enterprise_change_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY enterprise_profiles_tenant_all ON platform.enterprise_profiles
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY legal_entities_tenant_all ON platform.legal_entities
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY legal_entity_registration_identifiers_tenant_all ON platform.legal_entity_registration_identifiers
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY legal_entity_addresses_tenant_all ON platform.legal_entity_addresses
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY legal_entity_classifications_tenant_all ON platform.legal_entity_classifications
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY legal_entity_business_functions_tenant_all ON platform.legal_entity_business_functions
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY ownership_interests_tenant_all ON platform.ownership_interests
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY beneficial_owners_tenant_all ON platform.beneficial_owners
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY organization_legal_entity_bindings_tenant_all ON platform.organization_legal_entity_bindings
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY organization_closure_tenant_all ON platform.organization_closure
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY membership_organizations_tenant_all ON platform.membership_organizations
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY enterprise_change_requests_tenant_all ON platform.enterprise_change_requests
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
