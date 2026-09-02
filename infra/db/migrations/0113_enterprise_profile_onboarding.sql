BEGIN;

-- Governed enterprise-profile onboarding.
-- Tenant remains the commercial/security boundary. This migration turns the
-- bootstrap enterprise profile into an explicitly configured business object
-- with one primary root authority for enterprise-wide governance.

ALTER TABLE platform.enterprise_profiles
  ADD COLUMN configuration_state text NOT NULL DEFAULT 'BOOTSTRAPPED'
    CHECK (configuration_state IN ('BOOTSTRAPPED','CONFIGURED')),
  ADD COLUMN root_organization_id uuid,
  ADD COLUMN configured_at timestamptz,
  ADD COLUMN configured_by_subject_id text;

-- Existing tenants already have operational organizations. Backfill a
-- deterministic root authority from an existing top-level organization without
-- pretending that the profile has completed governed configuration.
WITH ranked_roots AS (
  SELECT
    organization.tenant_id,
    organization.enterprise_id,
    organization.organization_id,
    row_number() OVER (
      PARTITION BY organization.tenant_id, organization.enterprise_id
      ORDER BY organization.created_at ASC, organization.organization_id ASC
    ) AS rank
  FROM platform.organizations organization
  WHERE organization.parent_organization_id IS NULL
)
UPDATE platform.enterprise_profiles enterprise
   SET root_organization_id = root.organization_id
  FROM ranked_roots root
 WHERE root.rank = 1
   AND root.tenant_id = enterprise.tenant_id
   AND root.enterprise_id = enterprise.enterprise_id;

ALTER TABLE platform.enterprise_profiles
  ADD CONSTRAINT enterprise_profiles_root_same_enterprise_fk
  FOREIGN KEY (root_organization_id, tenant_id, enterprise_id)
  REFERENCES platform.organizations(organization_id, tenant_id, enterprise_id)
  ON DELETE RESTRICT;

ALTER TABLE platform.enterprise_profiles
  ADD CONSTRAINT enterprise_profiles_configured_metadata_check
  CHECK (
    (configuration_state = 'CONFIGURED'
      AND root_organization_id IS NOT NULL
      AND configured_at IS NOT NULL
      AND btrim(configured_by_subject_id) <> '')
    OR
    (configuration_state = 'BOOTSTRAPPED'
      AND configured_at IS NULL
      AND configured_by_subject_id IS NULL)
  );

-- Enterprise profile configuration is a governed enterprise change operation.
ALTER TABLE platform.enterprise_change_requests
  DROP CONSTRAINT IF EXISTS enterprise_change_requests_operation_check;

ALTER TABLE platform.enterprise_change_requests
  ADD CONSTRAINT enterprise_change_requests_operation_check
  CHECK (operation IN (
    'CREATE_ORGANIZATION','REPARENT_ORGANIZATION','CREATE_LEGAL_ENTITY',
    'CHANGE_OWNERSHIP','CHANGE_OPERATING_ENTITY','APPOINT_PARTNER',
    'EXPAND_TERRITORY','ACTIVATE_JURISDICTION','SUSPEND_ORGANIZATION',
    'CONFIGURE_ENTERPRISE_PROFILE'
  ));

COMMIT;
