BEGIN;

CREATE TABLE platform.company_brain_correction_proposals (
  proposal_reference text PRIMARY KEY CHECK (btrim(proposal_reference) <> ''),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  execution_id text NOT NULL CHECK (btrim(execution_id) <> ''),
  proposer_subject_id text NOT NULL CHECK (btrim(proposer_subject_id) <> ''),
  agent_id text NOT NULL CHECK (btrim(agent_id) <> ''),
  category text NOT NULL CHECK (category IN (
    'OUTDATED_FACT', 'STRATEGIC_MISALIGNMENT', 'POLICY_VIOLATION',
    'PROCEDURAL_FAILURE', 'CAPABILITY_DRIFT', 'DANGEROUS_ACTION'
  )),
  target_kind text NOT NULL CHECK (target_kind IN (
    'COMPANY_FACT', 'ADR', 'POLICY', 'SKILL', 'WORKER', 'MECHANICAL_GATE'
  )),
  target_reference text NOT NULL CHECK (btrim(target_reference) <> ''),
  original_output_reference text NOT NULL CHECK (btrim(original_output_reference) <> ''),
  original_output_digest text NOT NULL CHECK (
    original_output_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  proposed_correction_reference text NOT NULL CHECK (
    btrim(proposed_correction_reference) <> ''
  ),
  proposed_correction_digest text NOT NULL CHECK (
    proposed_correction_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  reason_key text NOT NULL CHECK (btrim(reason_key) <> ''),
  status text NOT NULL DEFAULT 'UNREVIEWED' CHECK (status = 'UNREVIEWED'),
  created_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  evidence_refs text[] NOT NULL CHECK (
    cardinality(evidence_refs) > 0 AND array_position(evidence_refs, NULL) IS NULL
  ),
  CHECK (original_output_reference <> proposed_correction_reference),
  CHECK (original_output_digest <> proposed_correction_digest),
  CHECK (
    (category = 'OUTDATED_FACT' AND target_kind = 'COMPANY_FACT')
    OR (category = 'STRATEGIC_MISALIGNMENT' AND target_kind = 'ADR')
    OR (category = 'POLICY_VIOLATION' AND target_kind = 'POLICY')
    OR (category = 'PROCEDURAL_FAILURE' AND target_kind = 'SKILL')
    OR (category = 'CAPABILITY_DRIFT' AND target_kind = 'WORKER')
    OR (category = 'DANGEROUS_ACTION' AND target_kind = 'MECHANICAL_GATE')
  )
);

CREATE INDEX company_brain_corrections_target_idx
  ON platform.company_brain_correction_proposals (
    tenant_id, target_kind, target_reference, created_at DESC
  );

CREATE OR REPLACE FUNCTION platform.reject_company_brain_correction_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Company Brain correction history is immutable';
END;
$$;

CREATE TRIGGER company_brain_corrections_immutable
BEFORE UPDATE OR DELETE ON platform.company_brain_correction_proposals
FOR EACH ROW EXECUTE FUNCTION platform.reject_company_brain_correction_mutation();

ALTER TABLE platform.company_brain_correction_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.company_brain_correction_proposals FORCE ROW LEVEL SECURITY;

CREATE POLICY company_brain_corrections_select
  ON platform.company_brain_correction_proposals FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY company_brain_corrections_insert
  ON platform.company_brain_correction_proposals FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
