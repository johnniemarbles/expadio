BEGIN;

-- Decision Fabric — per-subject approval-authority grants.
--
-- The four-eyes/role authority (0247/0250) says *who* may approve; this says
-- *how much* they may approve and *where*. One row grants a subject authority on
-- one dimension, optionally scoped to an organization and optionally delegated
-- from a principal. The decision-capture authority provider consults these to
-- satisfy a stage's authority requirements (e.g. a monetary threshold derived
-- from the case's agreements). Tenant-scoped and RLS-forced.

CREATE TABLE platform.workflow_authority_grants (
  grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  subject_id text NOT NULL CHECK (btrim(subject_id) <> ''),
  dimension_key text NOT NULL CHECK (btrim(dimension_key) <> ''),
  -- Monetary dimension: a ceiling the subject may approve, in minor units.
  threshold_minor_units bigint CHECK (threshold_minor_units IS NULL OR threshold_minor_units >= 0),
  currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  -- Scope: TENANT covers everything; ORGANIZATION covers one org.
  scope_type text NOT NULL DEFAULT 'TENANT' CHECK (scope_type IN ('TENANT','ORGANIZATION')),
  scope_entity_id text,
  -- Delegation: authority granted on behalf of a principal (provenance).
  delegated_from_subject_id text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  granted_by_subject_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_authority_grants_scope_check CHECK (
    (scope_type = 'TENANT' AND scope_entity_id IS NULL)
    OR (scope_type = 'ORGANIZATION' AND scope_entity_id IS NOT NULL)
  )
);

CREATE INDEX workflow_authority_grants_lookup_idx
  ON platform.workflow_authority_grants (tenant_id, subject_id, dimension_key, status);

ALTER TABLE platform.workflow_authority_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.workflow_authority_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_authority_grants_tenant_all
  ON platform.workflow_authority_grants
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
