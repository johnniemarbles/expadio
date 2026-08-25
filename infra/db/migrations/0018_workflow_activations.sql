BEGIN;

CREATE TABLE platform.workflow_activations (
  activation_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  instance_id uuid NOT NULL,
  work_type_key text NOT NULL CHECK (btrim(work_type_key) <> ''),
  blueprint_key text NOT NULL CHECK (btrim(blueprint_key) <> ''),
  blueprint_version integer NOT NULL CHECK (blueprint_version > 0),
  provisioning_model text NOT NULL CHECK (
    provisioning_model IN (
      'FULL_WORKSPACE',
      'SCOPED_WORKSPACE',
      'RESTRICTED_PORTAL',
      'ACCOUNT_ONLY',
      'NO_PROVISIONING'
    )
  ),
  source_rights_grant_ids uuid[] NOT NULL CHECK (
    cardinality(source_rights_grant_ids) > 0
    AND array_position(source_rights_grant_ids, NULL) IS NULL
  ),
  verification_state text NOT NULL CHECK (
    verification_state IN ('NOT_VERIFIED', 'IN_PROGRESS', 'VERIFIED', 'FAILED')
  ),
  provisioned_resource_refs text[] NOT NULL DEFAULT ARRAY[]::text[],
  started_at timestamptz,
  completed_at timestamptz,
  verified_by_subject_id text,
  verified_at timestamptz,
  verification_evidence_refs text[] NOT NULL DEFAULT ARRAY[]::text[],
  FOREIGN KEY (instance_id, tenant_id)
    REFERENCES platform.workflow_instances(instance_id, tenant_id)
    ON DELETE CASCADE,
  UNIQUE (activation_id, tenant_id),
  CONSTRAINT workflow_activations_completed_at_check CHECK (
    completed_at IS NULL OR started_at IS NOT NULL
  ),
  CONSTRAINT workflow_activations_verified_check CHECK (
    verification_state <> 'VERIFIED'
    OR (
      verified_at IS NOT NULL
      AND verified_by_subject_id IS NOT NULL
      AND btrim(verified_by_subject_id) <> ''
    )
  )
);

CREATE INDEX workflow_activations_tenant_instance_idx
  ON platform.workflow_activations (tenant_id, instance_id, activation_id);

CREATE OR REPLACE FUNCTION platform.validate_workflow_activation_source_grants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  matching_grant_count integer;
BEGIN
  SELECT count(*)
    INTO matching_grant_count
    FROM platform.workflow_rights_grants grant_record
   WHERE grant_record.grant_id = ANY (NEW.source_rights_grant_ids)
     AND grant_record.tenant_id = NEW.tenant_id
     AND grant_record.instance_id = NEW.instance_id;

  IF matching_grant_count <> cardinality(NEW.source_rights_grant_ids) THEN
    RAISE EXCEPTION 'activation source rights grants must be unique and belong to the same tenant and workflow instance';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER workflow_activations_validate_source_grants
BEFORE INSERT ON platform.workflow_activations
FOR EACH ROW EXECUTE FUNCTION platform.validate_workflow_activation_source_grants();

CREATE OR REPLACE FUNCTION platform.reject_workflow_activation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'workflow activations are immutable';
END;
$$;

CREATE TRIGGER workflow_activations_immutable
BEFORE UPDATE OR DELETE ON platform.workflow_activations
FOR EACH ROW EXECUTE FUNCTION platform.reject_workflow_activation_mutation();

ALTER TABLE platform.workflow_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.workflow_activations FORCE ROW LEVEL SECURITY;

CREATE POLICY workflow_activations_select
  ON platform.workflow_activations
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY workflow_activations_insert
  ON platform.workflow_activations
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
