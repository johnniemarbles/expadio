BEGIN;

-- Platform operator provision: storage tenant/org/unit + membership + T/B/L binding.
-- Does not mint codes from UUIDs. Codes must be supplied. Not Brand, not CRM.

CREATE OR REPLACE FUNCTION platform.provision_product_scope(
  p_subject_id text,
  p_tenant_code text,
  p_brand_code text,
  p_location_code text,
  p_tenant_name text,
  p_organization_name text,
  p_unit_name text,
  p_create_tenant boolean
)
RETURNS TABLE (
  tenant_code text,
  brand_code text,
  location_code text,
  tenant_id uuid,
  organization_id uuid,
  operating_unit_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_org_id uuid;
  v_unit_id uuid;
  v_membership_tenant uuid;
  v_existing platform.product_scope_bindings%ROWTYPE;
BEGIN
  IF p_subject_id IS NULL OR btrim(p_subject_id) = '' THEN
    RAISE EXCEPTION 'NO_MEMBERSHIP';
  END IF;
  IF p_tenant_code !~ '^T-[0-9]{4,}$' OR p_brand_code !~ '^B-[0-9]{4,}$' THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_SCOPE_CODE';
  END IF;
  IF p_location_code IS DISTINCT FROM 'ALL' AND p_location_code !~ '^L-[0-9]{4,}$' THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_SCOPE_CODE';
  END IF;

  SELECT m.tenant_id
    INTO v_membership_tenant
    FROM platform.memberships m
   WHERE m.subject_id = p_subject_id
     AND m.status = 'ACTIVE'
     AND (m.valid_until IS NULL OR m.valid_until > now())
   ORDER BY m.created_at ASC
   LIMIT 1;

  IF v_membership_tenant IS NULL THEN
    RAISE EXCEPTION 'NO_MEMBERSHIP';
  END IF;

  SELECT b.tenant_id INTO v_tenant_id
    FROM platform.product_scope_bindings b
   WHERE b.tenant_code = p_tenant_code
   LIMIT 1;

  IF v_tenant_id IS NOT NULL THEN
    IF v_tenant_id IS DISTINCT FROM v_membership_tenant AND NOT EXISTS (
      SELECT 1
        FROM platform.authorization_assignments a
        JOIN platform.authorization_roles r ON r.role_id = a.role_id
       WHERE a.subject_id = p_subject_id
         AND a.status = 'ACTIVE'
         AND r.role_key = 'PLATFORM_SUPER_ADMIN'
    ) THEN
      RAISE EXCEPTION 'TENANT_OUT_OF_SCOPE';
    END IF;
  ELSIF p_create_tenant THEN
    INSERT INTO platform.tenants (name, status)
    VALUES (COALESCE(NULLIF(btrim(p_tenant_name), ''), 'Tenant'), 'ACTIVE')
    RETURNING platform.tenants.tenant_id INTO v_tenant_id;
  ELSE
    v_tenant_id := v_membership_tenant;
  END IF;

  SELECT b.* INTO v_existing
    FROM platform.product_scope_bindings b
   WHERE b.tenant_code = p_tenant_code
     AND b.brand_code = p_brand_code
     AND b.location_code = p_location_code;

  IF FOUND THEN
    IF v_existing.tenant_id IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION 'BINDING_CONFLICT';
    END IF;
    tenant_code := v_existing.tenant_code;
    brand_code := v_existing.brand_code;
    location_code := v_existing.location_code;
    tenant_id := v_existing.tenant_id;
    organization_id := v_existing.organization_id;
    operating_unit_id := v_existing.operating_unit_id;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT b.organization_id INTO v_org_id
    FROM platform.product_scope_bindings b
   WHERE b.brand_code = p_brand_code
     AND b.tenant_id = v_tenant_id
   LIMIT 1;

  IF v_org_id IS NULL THEN
    INSERT INTO platform.organizations (tenant_id, organization_kind, name, status)
    VALUES (
      v_tenant_id,
      'BUSINESS',
      COALESCE(NULLIF(btrim(p_organization_name), ''), 'Brand workspace'),
      'ACTIVE'
    )
    RETURNING platform.organizations.organization_id INTO v_org_id;
  END IF;

  IF p_location_code = 'ALL' THEN
    v_unit_id := NULL;
  ELSE
    INSERT INTO platform.operating_units (tenant_id, organization_id, unit_kind, name, status)
    VALUES (
      v_tenant_id,
      v_org_id,
      'UNIT',
      COALESCE(NULLIF(btrim(p_unit_name), ''), 'Primary location'),
      'ACTIVE'
    )
    RETURNING platform.operating_units.operating_unit_id INTO v_unit_id;
  END IF;

  INSERT INTO platform.memberships (
    tenant_id, organization_id, subject_id, actor_kind, status, issuer,
    workspace_scope_mode, operating_unit_scope_mode
  )
  SELECT v_tenant_id, v_org_id, p_subject_id, 'user', 'ACTIVE', 'https://clerk.expadio.com', 'ALL', 'ALL'
   WHERE NOT EXISTS (
     SELECT 1 FROM platform.memberships m
      WHERE m.tenant_id = v_tenant_id
        AND m.organization_id = v_org_id
        AND m.subject_id = p_subject_id
        AND m.status = 'ACTIVE'
   );

  INSERT INTO platform.product_scope_bindings (
    tenant_code, brand_code, location_code, tenant_id, organization_id, operating_unit_id, status
  )
  VALUES (p_tenant_code, p_brand_code, p_location_code, v_tenant_id, v_org_id, v_unit_id, 'ACTIVE')
  RETURNING
    platform.product_scope_bindings.tenant_code,
    platform.product_scope_bindings.brand_code,
    platform.product_scope_bindings.location_code,
    platform.product_scope_bindings.tenant_id,
    platform.product_scope_bindings.organization_id,
    platform.product_scope_bindings.operating_unit_id
  INTO tenant_code, brand_code, location_code, tenant_id, organization_id, operating_unit_id;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION platform.provision_product_scope(text, text, text, text, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.provision_product_scope(text, text, text, text, text, text, text, boolean) TO PUBLIC;

COMMENT ON FUNCTION platform.provision_product_scope(text, text, text, text, text, text, text, boolean) IS
  'Platform operator provision of storage plus T/B/L binding. Does not allocate codes or send communications.';

COMMIT;
