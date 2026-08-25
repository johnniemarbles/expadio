BEGIN;

ALTER TABLE platform.workflow_activations
  ADD CONSTRAINT workflow_activations_tenant_instance_identity_uq
  UNIQUE (activation_id, tenant_id, instance_id);

CREATE TABLE platform.workflow_activation_verifications (
  verification_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  instance_id uuid NOT NULL,
  activation_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('VERIFIED', 'FAILED')),
  assessments jsonb NOT NULL CHECK (
    jsonb_typeof(assessments) = 'array'
    AND jsonb_array_length(assessments) = 5
  ),
  verified_by_subject_id text NOT NULL CHECK (btrim(verified_by_subject_id) <> ''),
  verified_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  evidence_refs text[] NOT NULL CHECK (
    cardinality(evidence_refs) > 0
    AND array_position(evidence_refs, NULL) IS NULL
  ),
  FOREIGN KEY (activation_id, tenant_id, instance_id)
    REFERENCES platform.workflow_activations(activation_id, tenant_id, instance_id)
    ON DELETE CASCADE,
  UNIQUE (verification_id, tenant_id)
);

CREATE INDEX workflow_activation_verifications_tenant_activation_idx
  ON platform.workflow_activation_verifications
    (tenant_id, activation_id, verified_at DESC);

CREATE OR REPLACE FUNCTION platform.reject_workflow_activation_verification_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'workflow activation verifications are immutable';
END;
$$;

CREATE TRIGGER workflow_activation_verifications_immutable
BEFORE UPDATE OR DELETE ON platform.workflow_activation_verifications
FOR EACH ROW EXECUTE FUNCTION platform.reject_workflow_activation_verification_mutation();

ALTER TABLE platform.workflow_activation_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.workflow_activation_verifications FORCE ROW LEVEL SECURITY;

CREATE POLICY workflow_activation_verifications_select
  ON platform.workflow_activation_verifications
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY workflow_activation_verifications_insert
  ON platform.workflow_activation_verifications
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
