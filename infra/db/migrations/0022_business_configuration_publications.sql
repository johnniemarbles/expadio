BEGIN;

CREATE TABLE platform.business_configuration_publications (
  publication_id uuid PRIMARY KEY,
  changeset_id uuid NOT NULL,
  scope_kind text NOT NULL CHECK (scope_kind IN ('PLATFORM', 'VERTICAL', 'TENANT')),
  scope_key text,
  tenant_id uuid REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  base_revision integer NOT NULL CHECK (base_revision >= 0),
  revision integer NOT NULL CHECK (revision = base_revision + 1),
  published_by_subject_id text NOT NULL CHECK (btrim(published_by_subject_id) <> ''),
  published_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  evidence_refs text[] NOT NULL CHECK (
    cardinality(evidence_refs) > 0
    AND array_position(evidence_refs, NULL) IS NULL
  ),
  CHECK (
    (scope_kind = 'PLATFORM' AND scope_key IS NULL AND tenant_id IS NULL)
    OR (scope_kind = 'VERTICAL' AND btrim(scope_key) <> '' AND tenant_id IS NULL)
    OR (
      scope_kind = 'TENANT'
      AND scope_key = tenant_id::text
      AND tenant_id IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX business_configuration_publications_changeset_idx
  ON platform.business_configuration_publications
    (scope_kind, COALESCE(scope_key, ''), changeset_id);

CREATE UNIQUE INDEX business_configuration_publications_revision_idx
  ON platform.business_configuration_publications
    (scope_kind, COALESCE(scope_key, ''), revision);

CREATE TABLE platform.business_configuration_objects (
  object_id uuid PRIMARY KEY,
  publication_id uuid NOT NULL
    REFERENCES platform.business_configuration_publications(publication_id)
    ON DELETE CASCADE,
  scope_kind text NOT NULL CHECK (scope_kind IN ('PLATFORM', 'VERTICAL', 'TENANT')),
  scope_key text,
  tenant_id uuid REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'INDUSTRY', 'ONTOLOGY', 'TERMINOLOGY', 'PERSONA', 'ROLE',
    'RELATIONSHIP', 'TEAM', 'SKILL', 'CERTIFICATION', 'POLICY', 'LIFECYCLE'
  )),
  object_key text NOT NULL CHECK (btrim(object_key) <> ''),
  version integer NOT NULL CHECK (version > 0),
  label text NOT NULL CHECK (btrim(label) <> ''),
  payload jsonb NOT NULL,
  dependencies jsonb NOT NULL CHECK (jsonb_typeof(dependencies) = 'array'),
  authored_by_subject_id text NOT NULL CHECK (btrim(authored_by_subject_id) <> ''),
  authored_at timestamptz NOT NULL,
  CHECK (
    (scope_kind = 'PLATFORM' AND scope_key IS NULL AND tenant_id IS NULL)
    OR (scope_kind = 'VERTICAL' AND btrim(scope_key) <> '' AND tenant_id IS NULL)
    OR (
      scope_kind = 'TENANT'
      AND scope_key = tenant_id::text
      AND tenant_id IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX business_configuration_objects_identity_idx
  ON platform.business_configuration_objects
    (scope_kind, COALESCE(scope_key, ''), kind, object_key, version);

CREATE OR REPLACE FUNCTION platform.validate_business_configuration_publication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_revision integer;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      NEW.scope_kind || ':' || COALESCE(NEW.scope_key, ''),
      0
    )
  );

  SELECT COALESCE(max(publication.revision), 0)
    INTO current_revision
    FROM platform.business_configuration_publications publication
   WHERE publication.scope_kind = NEW.scope_kind
     AND COALESCE(publication.scope_key, '') = COALESCE(NEW.scope_key, '');

  IF NEW.base_revision <> current_revision THEN
    RAISE EXCEPTION 'configuration expected revision %, current revision %',
      NEW.base_revision, current_revision
      USING ERRCODE = '40001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER business_configuration_publications_validate
BEFORE INSERT ON platform.business_configuration_publications
FOR EACH ROW EXECUTE FUNCTION platform.validate_business_configuration_publication();

CREATE OR REPLACE FUNCTION platform.reject_business_configuration_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'published business configuration is immutable';
END;
$$;

CREATE TRIGGER business_configuration_publications_immutable
BEFORE UPDATE OR DELETE ON platform.business_configuration_publications
FOR EACH ROW EXECUTE FUNCTION platform.reject_business_configuration_mutation();

CREATE TRIGGER business_configuration_objects_immutable
BEFORE UPDATE OR DELETE ON platform.business_configuration_objects
FOR EACH ROW EXECUTE FUNCTION platform.reject_business_configuration_mutation();

ALTER TABLE platform.business_configuration_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.business_configuration_publications FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.business_configuration_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.business_configuration_objects FORCE ROW LEVEL SECURITY;

CREATE POLICY business_configuration_publications_select
  ON platform.business_configuration_publications
  FOR SELECT
  USING (
    scope_kind IN ('PLATFORM', 'VERTICAL')
    OR tenant_id = platform.current_tenant_id()
  );

CREATE POLICY business_configuration_publications_insert
  ON platform.business_configuration_publications
  FOR INSERT
  WITH CHECK (
    scope_kind = 'TENANT'
    AND tenant_id = platform.current_tenant_id()
  );

CREATE POLICY business_configuration_objects_select
  ON platform.business_configuration_objects
  FOR SELECT
  USING (
    scope_kind IN ('PLATFORM', 'VERTICAL')
    OR tenant_id = platform.current_tenant_id()
  );

CREATE POLICY business_configuration_objects_insert
  ON platform.business_configuration_objects
  FOR INSERT
  WITH CHECK (
    scope_kind = 'TENANT'
    AND tenant_id = platform.current_tenant_id()
  );

COMMIT;
