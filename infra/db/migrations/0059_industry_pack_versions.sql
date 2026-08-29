BEGIN;

CREATE TABLE platform.industry_pack_versions (
  pack_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  vertical_key text NOT NULL CHECK (btrim(vertical_key) <> ''),
  version integer NOT NULL CHECK (version > 0),
  source text NOT NULL CHECK (source IN ('CODE_BASELINE','PLATFORM_AUTHORED','TENANT_AUTHORED')),
  state text NOT NULL CHECK (state IN ('DRAFT','IN_REVIEW','PUBLISHED','SUPERSEDED','ARCHIVED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  parent_vertical_key text,
  parent_version integer CHECK (parent_version IS NULL OR parent_version > 0),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by_subject_id text NOT NULL CHECK (btrim(updated_by_subject_id) <> ''),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_by_subject_id text,
  submitted_at timestamptz,
  published_by_subject_id text,
  published_at timestamptz,
  CONSTRAINT industry_pack_versions_scope_source_check CHECK (
    (tenant_id IS NULL AND source IN ('CODE_BASELINE','PLATFORM_AUTHORED'))
    OR
    (tenant_id IS NOT NULL AND source = 'TENANT_AUTHORED')
  ),
  CONSTRAINT industry_pack_versions_parent_check CHECK (
    (parent_vertical_key IS NULL AND parent_version IS NULL)
    OR
    (parent_vertical_key IS NOT NULL AND btrim(parent_vertical_key) <> '' AND parent_version IS NOT NULL)
  ),
  CONSTRAINT industry_pack_versions_submission_metadata_check CHECK (
    (submitted_by_subject_id IS NULL AND submitted_at IS NULL)
    OR
    (submitted_by_subject_id IS NOT NULL AND submitted_at IS NOT NULL)
  ),
  CONSTRAINT industry_pack_versions_publication_metadata_check CHECK (
    (published_by_subject_id IS NULL AND published_at IS NULL)
    OR
    (published_by_subject_id IS NOT NULL AND published_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX industry_pack_versions_platform_identity_uq
  ON platform.industry_pack_versions (lower(vertical_key), version)
  WHERE tenant_id IS NULL;

CREATE UNIQUE INDEX industry_pack_versions_tenant_identity_uq
  ON platform.industry_pack_versions (tenant_id, lower(vertical_key), version)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX industry_pack_versions_platform_lookup_idx
  ON platform.industry_pack_versions (lower(vertical_key), version DESC)
  WHERE tenant_id IS NULL;

CREATE INDEX industry_pack_versions_tenant_lookup_idx
  ON platform.industry_pack_versions (tenant_id, lower(vertical_key), version DESC)
  WHERE tenant_id IS NOT NULL;

CREATE OR REPLACE FUNCTION platform.enforce_industry_pack_version_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'DRAFT' THEN
      RAISE EXCEPTION 'published industry pack versions are immutable'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR lower(OLD.vertical_key) IS DISTINCT FROM lower(NEW.vertical_key)
     OR OLD.version IS DISTINCT FROM NEW.version
     OR OLD.source IS DISTINCT FROM NEW.source
     OR OLD.created_by_subject_id IS DISTINCT FROM NEW.created_by_subject_id
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'industry pack version identity/provenance is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state <> 'DRAFT' AND OLD.definition IS DISTINCT FROM NEW.definition THEN
    RAISE EXCEPTION 'published industry pack definitions are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state <> 'DRAFT' AND OLD.revision IS DISTINCT FROM NEW.revision THEN
    RAISE EXCEPTION 'published industry pack draft revision is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state = 'DRAFT'
     AND OLD.definition IS DISTINCT FROM NEW.definition
     AND NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'draft definition edits must increment revision by one'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state = 'DRAFT'
     AND OLD.definition IS NOT DISTINCT FROM NEW.definition
     AND NEW.revision IS DISTINCT FROM OLD.revision THEN
    RAISE EXCEPTION 'draft revision may change only with a definition edit'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER industry_pack_versions_immutability
BEFORE UPDATE OR DELETE ON platform.industry_pack_versions
FOR EACH ROW EXECUTE FUNCTION platform.enforce_industry_pack_version_immutability();

ALTER TABLE platform.industry_pack_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.industry_pack_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY industry_pack_versions_select
  ON platform.industry_pack_versions
  FOR SELECT
  USING (
    tenant_id = platform.current_tenant_id()
    OR (
      tenant_id IS NULL
      AND state IN ('PUBLISHED','SUPERSEDED','ARCHIVED')
    )
  );

CREATE POLICY industry_pack_versions_tenant_insert
  ON platform.industry_pack_versions
  FOR INSERT
  WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_id = platform.current_tenant_id()
    AND source = 'TENANT_AUTHORED'
  );

CREATE POLICY industry_pack_versions_tenant_update
  ON platform.industry_pack_versions
  FOR UPDATE
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = platform.current_tenant_id()
  )
  WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_id = platform.current_tenant_id()
    AND source = 'TENANT_AUTHORED'
  );

CREATE POLICY industry_pack_versions_tenant_delete
  ON platform.industry_pack_versions
  FOR DELETE
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = platform.current_tenant_id()
    AND state = 'DRAFT'
  );

COMMIT;
